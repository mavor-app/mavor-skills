---
name: shopify-low-inventory-restock
displayName: Low Inventory Restock
description: >-
  Query all tracked product variants below a stock threshold and export a
  restock list grouped by vendor.
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
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
  dry_run:
    type: boolean
    required: false
    description: Preview operations without executing mutations
  threshold:
    type: number
    required: false
    description: Variants at or below this quantity are included
  location_id:
    type: string
    required: false
    description: >-
      GID of a specific location to filter by (optional; if omitted, uses
      `inventoryQuantity` across all locations)
  include_zero_stock:
    type: boolean
    required: false
    description: Include variants with 0 quantity
---
## Purpose
Queries all tracked product variants at or below a configurable stock threshold and exports a restock CSV grouped by vendor. By pulling live inventory counts directly from the Shopify Admin API and sorting results by vendor name, this skill gives procurement teams an immediately actionable reorder list without manual exports from the Shopify admin inventory view.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| format | string | no | human | Output format: `human` or `json` |
| dry_run | bool | no | false | Preview operations without executing mutations |
| threshold | integer | no | 10 | Variants at or below this quantity are included |
| location_id | string | no | — | GID of a specific location to filter by (optional; if omitted, uses `inventoryQuantity` across all locations) |
| include_zero_stock | bool | no | true | Include variants with 0 quantity |

## Workflow Steps

1. **OPERATION:** `productVariants` — query
   **Inputs:** `first: 250`, `query: "inventory_quantity:<= <threshold>"`, pagination cursor
   **Expected output:** List of variant objects with inventoryQuantity, product title, vendor, SKU; paginate until `hasNextPage: false`

## GraphQL Operations

```graphql
# productVariants:query — validated against api_version 2025-01
query LowInventoryVariants($first: Int!, $after: String, $query: String) {
  productVariants(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        title
        sku
        inventoryQuantity
        product {
          id
          title
          vendor
        }
        inventoryItem {
          id
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

## Output Format
CSV file `restock_list_<YYYY-MM-DD>.csv` grouped by vendor, sorted by vendor name then product title. Columns: `vendor`, `product_title`, `variant_title`, `sku`, `current_stock`.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| No variants returned | All variants are above threshold or inventory not tracked | Lower threshold or verify `inventoryItem.tracked: true` |
| `location_id` not found | Invalid location GID | Retrieve valid location IDs via Shopify admin |
| Rate limit (429) | Too many paginated requests | Reduce `first` to 100 and retry |

## Best Practices
1. Run without `location_id` first to get store-wide low stock; then filter by location if you operate multiple warehouses.
2. Only variants with `inventoryItem.tracked: true` have meaningful stock counts — untracked variants always appear as 0.
3. The restock CSV is sorted by vendor — share the vendor-grouped output directly with your procurement team without reformatting.
4. Set `include_zero_stock: false` to skip variants already on back-order to focus on nearly-depleted items.
5. You can run this workflow on a schedule using Mavor automations.
