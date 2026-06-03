---
name: shopify-inventory-valuation-report
displayName: Inventory Valuation Report
description: >-
  Read-only: calculates total inventory value (quantity × cost) per location and
  per vendor for accounting and insurance.
version: 1.0.0
category: merchandising
runtime:
  type: llm
  executor: auto
capabilities:
  tools:
    - shopify_graphql_query
  permissions:
    - shop.read
tags:
  - shopify
  - merchandising
input:
  breakdown:
    type: string
    required: false
    description: 'Breakdown level: `location`, `vendor`, or `both`'
  include_zero_cost:
    type: boolean
    required: false
    description: Include items with no cost set (shown as $0)
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Calculates the total inventory value (on-hand quantity × unit cost) broken down by location and vendor. Used for periodic balance sheet reconciliation, insurance valuation, and cost-of-goods reporting. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| breakdown | string | no | both | Breakdown level: `location`, `vendor`, or `both` |
| include_zero_cost | bool | no | true | Include items with no cost set (shown as $0) |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `locations` — query
   **Inputs:** `first: 50`, active locations only
   **Expected output:** All active location IDs and names

2. **OPERATION:** `productVariants` — query
   **Inputs:** `first: 250`, select `sku`, `inventoryQuantity`, `product { vendor }`, `inventoryItem { id, unitCost }`, pagination cursor
   **Expected output:** All variants with cost and stock; paginate until `hasNextPage: false`

3. **OPERATION:** `inventoryItems` — query
   **Inputs:** Batch by inventory item IDs; fetch `inventoryLevels` per location
   **Expected output:** Per-location quantities for each inventory item

4. Calculate: for each (variant, location) pair: `value = quantity × unit_cost`; aggregate by location and vendor

## GraphQL Operations

```graphql
# locations:query — validated against api_version 2025-01
query ActiveLocationsForValuation {
  locations(first: 50, includeInactive: false) {
    edges {
      node {
        id
        name
        isActive
      }
    }
  }
}
```

```graphql
# productVariants:query — validated against api_version 2025-01
query VariantsForValuation($after: String) {
  productVariants(first: 250, after: $after) {
    edges {
      node {
        id
        sku
        inventoryQuantity
        product {
          id
          title
          vendor
        }
        inventoryItem {
          id
          unitCost {
            amount
            currencyCode
          }
          tracked
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

```graphql
# inventoryItems:query — validated against api_version 2025-01
query InventoryLevelsByLocation($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on InventoryItem {
      id
      sku
      inventoryLevels(first: 20) {
        edges {
          node {
            location {
              id
              name
            }
            quantities(names: ["on_hand"]) {
              name
              quantity
            }
          }
        }
      }
    }
  }
}
```

## Output Format
CSV file `inventory_valuation_<YYYY-MM-DD>.csv` with columns:
`variant_id`, `sku`, `product_title`, `vendor`, `location`, `quantity_on_hand`, `unit_cost`, `total_value`, `currency`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No unit cost set | Variants without cost data | Include at $0, flag in report |
| No active locations | Store has no locations configured | Exit with error |

## Best Practices
- Run at month-end for balance sheet reconciliation — compare with your accounting system to identify discrepancies.
- Items with no cost set will appear as $0 and understate total value. Use the output to identify and fill cost gaps before the next run.
- For insurance purposes, use the total value as the minimum replacement cost baseline — add a markup for retail pricing if required by your policy.
- Pair with `dead-stock-identifier` to understand what portion of your inventory value is tied up in slow-moving stock.
