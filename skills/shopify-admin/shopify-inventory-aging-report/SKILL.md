---
name: shopify-inventory-aging-report
displayName: Inventory Aging Report
description: >-
  Read-only: categorizes inventory into aging buckets (0-30, 31-60, 61-90, 90+
  days) based on time since last sale or receipt.
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
  buckets:
    type: string
    required: false
    description: Comma-separated aging buckets in days
  carrying_cost_pct:
    type: number
    required: false
    description: Annual carrying cost as % of inventory value (industry avg 20-30%)
  vendor_filter:
    type: string
    required: false
    description: Scope to specific vendor
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Categorizes all inventory into aging buckets based on how long items have been sitting without selling. Calculates carrying cost exposure by bucket to prioritize markdown or liquidation decisions. Goes deeper than dead-stock identification by providing aging granularity. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain |
| buckets | string | no | 0-30,31-60,61-90,91-180,181+ | Comma-separated aging buckets in days |
| carrying_cost_pct | float | no | 25 | Annual carrying cost as % of inventory value (industry avg 20-30%) |
| vendor_filter | string | no | — | Scope to specific vendor |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `productVariants` — query
   **Inputs:** `first: 250`, select `id`, `sku`, `inventoryQuantity`, `inventoryItem { id, unitCost }`, `product { title, vendor, status }`, pagination cursor
   **Expected output:** All variants with stock and cost data

2. Filter to variants with `inventoryQuantity > 0`

3. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - 365 days>'"`, `first: 250`, select `createdAt`, `lineItems { variant { id }, quantity }`, pagination cursor
   **Expected output:** Sales history to determine last-sold date per variant

4. For each stocked variant, determine aging:
   - Find most recent order containing this variant → last_sold_date
   - If never sold, use product creation date as proxy
   - **Age** = today - last_sold_date
   - Assign to aging bucket

5. **OPERATION:** `inventoryItems` — query
   **Inputs:** Inventory item IDs for cost data
   **Expected output:** Unit costs for value calculation

6. Calculate per bucket:
   - Total units
   - Total value (units × unitCost)
   - Monthly carrying cost = (value × carrying_cost_pct / 100) / 12
   - % of total inventory value

## GraphQL Operations

```graphql
# productVariants:query — validated against api_version 2025-01
query VariantsWithStock($query: String, $after: String) {
  productVariants(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        sku
        inventoryQuantity
        product { id title vendor status createdAt }
        inventoryItem {
          id
          unitCost { amount currencyCode }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

```graphql
# orders:query — validated against api_version 2025-01
query RecentSales($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        createdAt
        lineItems(first: 50) {
          edges {
            node {
              quantity
              variant { id }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

```graphql
# inventoryItems:query — validated against api_version 2025-01
query InventoryItemCosts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on InventoryItem {
      id
      unitCost { amount currencyCode }
    }
  }
}
```

## Output Format
CSV file `inventory_aging_<YYYY-MM-DD>.csv` with columns:
`variant_id`, `sku`, `product_title`, `vendor`, `quantity`, `unit_cost`, `total_value`, `last_sold_date`, `age_days`, `aging_bucket`, `monthly_carrying_cost`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Missing unitCost | No COGS data | Use $0 for value — flag as "cost unknown" |
| No sales history | New product or never sold | Use product creation date as aging start |

## Best Practices
- Use `carrying_cost_pct: 25` as default (includes storage, insurance, opportunity cost, shrinkage).
- Items in 90+ day buckets are strong candidates for markdowns — use `bulk-price-adjustment`.
- Cross-reference with `dead-stock-identifier` and `stock-velocity-report` for a complete inventory health picture.
- Run monthly to track aging trends and measure liquidation effectiveness.
