---
name: shopify-variant-performance-report
displayName: Variant Performance Report
description: >-
  Rank every product variant by revenue, units sold, and refund rate, then
  cross-reference against current inventory to identify dead weight vs. top
  performers.
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
  date_range_start:
    type: string
    required: true
    description: 'Start date in ISO 8601 (e.g., `2025-01-01`)'
  date_range_end:
    type: string
    required: true
    description: 'End date in ISO 8601 (e.g., `2025-01-31`)'
  top_n:
    type: number
    required: false
    description: Number of top and bottom variants to display
  sort_by:
    type: string
    required: false
    description: 'Ranking metric: `revenue`, `units`, or `refund_rate`'
  min_units:
    type: number
    required: false
    description: Exclude variants with fewer than N units sold in the period
---
## Purpose
Goes beyond product-level revenue by ranking every individual variant (size, color, option combination) on revenue, units sold, and refund rate, then joining against live inventory levels. Reveals which specific SKUs are driving the business and which are tying up capital on the shelf. Read-only — no mutations are executed.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| format | string | no | human | Output format: `human` or `json` |
| dry_run | bool | no | false | Preview operations without executing mutations |
| date_range_start | string | yes | — | Start date in ISO 8601 (e.g., `2025-01-01`) |
| date_range_end | string | yes | — | End date in ISO 8601 (e.g., `2025-01-31`) |
| top_n | integer | no | 30 | Number of top and bottom variants to display |
| sort_by | string | no | revenue | Ranking metric: `revenue`, `units`, or `refund_rate` |
| min_units | integer | no | 1 | Exclude variants with fewer than N units sold in the period |

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `first: 250`, `query: "created_at:>='<date_range_start>' created_at:<='<date_range_end>'"`, pagination cursor; select `lineItems` with `variant { id, sku, title, selectedOptions }`, `quantity`, `originalTotalSet`; and `refunds.refundLineItems` with variant id and `subtotalSet`
   **Expected output:** All orders in range; paginate until `hasNextPage: false`; aggregate in-memory per `variant.id`: units sold, gross revenue, refunded units, refunded amount, refund rate

2. **OPERATION:** `productVariants` — query
   **Inputs:** List of variant IDs collected in step 1, `first: 250`, pagination cursor; select `id`, `sku`, `title`, `selectedOptions`, `inventoryQuantity`, `product { id, title }`, `price`
   **Expected output:** Current inventory levels and metadata for each sold variant; joined with step-1 aggregates; variants present in inventory but with zero sales are flagged as dead stock candidates

3. **In-memory computation:** Sort merged dataset by `sort_by` metric; compute revenue-per-inventory-unit ratio (net revenue ÷ inventory quantity) to highlight variants earning little relative to shelf space; split output into top-N performers and bottom-N by the same metric

## GraphQL Operations

```graphql
# orders:query (variant line items + refunds) — validated against api_version 2025-01
query OrdersForVariantPerformance($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        createdAt
        lineItems(first: 50) {
          edges {
            node {
              quantity
              originalTotalSet {
                shopMoney { amount currencyCode }
              }
              variant {
                id
                sku
                title
                selectedOptions { name value }
                product { id title }
              }
            }
          }
        }
        refunds {
          refundLineItems(first: 50) {
            edges {
              node {
                quantity
                subtotalSet {
                  shopMoney { amount currencyCode }
                }
                lineItem {
                  variant { id }
                }
              }
            }
          }
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
# productVariants:query (inventory snapshot) — validated against api_version 2025-01
query VariantInventorySnapshot($first: Int!, $after: String, $query: String) {
  productVariants(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        sku
        title
        price
        selectedOptions { name value }
        inventoryQuantity
        product {
          id
          title
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
CSV file `variant_performance_<YYYY-MM-DD>.csv` with one row per variant:

| Column | Description |
|--------|-------------|
| `product_id` | Shopify product GID |
| `product_title` | Product name |
| `variant_id` | Shopify variant GID |
| `variant_title` | Option combination (e.g., "Blue / Large") |
| `sku` | Variant SKU |
| `units_sold` | Total units sold in period |
| `gross_revenue` | Revenue before refunds |
| `refunded_amount` | Total refund value |
| `net_revenue` | Gross minus refunds |
| `refund_rate_pct` | Refunded units ÷ sold units × 100 |
| `inventory_qty` | Current stock on hand |
| `revenue_per_inventory_unit` | Net revenue ÷ inventory qty (blank if inventory = 0) |

For `format: human`, two ranked tables are printed inline:
1. **Top performers** — top `top_n` variants by `sort_by` metric
2. **Dead weight** — bottom `top_n` variants by `revenue_per_inventory_unit` (≥ `min_units` sold, inventory > 0)

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit from paginating large order history | Wait 2 s, retry up to 3 times; narrow date range if persistent |
| `variant` is null on line item | Product or variant was deleted after purchase | Aggregate by line item title with `variant_id: null`; still counted in totals |
| `inventoryQuantity` is null | Variant uses fulfillment service (no tracked inventory) | Record as `inventory_qty: null`; exclude from revenue-per-unit ratio |
| No orders returned | No orders in date range | Widen date range |

## Best Practices
1. Run with a 30–90 day window first. Very wide windows produce large pagination chains and slow down step 1 significantly.
2. The `revenue_per_inventory_unit` column is the sharpest signal for dead weight — a high inventory count with near-zero revenue is a clear markdown candidate.
3. High `refund_rate_pct` on a specific size or color often points to a fit or quality issue — investigate before reordering that option.
4. Use `min_units: 5` to filter out statistical noise from variants with very few sales before making merchandising decisions.
5. Pair with `dead-stock-identifier` for a broader view of inventory health beyond the sales period captured here.
