---
name: shopify-return-cost-attribution
displayName: Return Cost Attribution
description: >-
  Read-only: calculates the true cost of returns by reason and product — refund
  dollars, restocking impact, shipping cost lost, and COGS impact for items
  written off.
version: 1.0.0
category: returns
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
  - returns
input:
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
  days_back:
    type: number
    required: false
    description: Lookback window for returns
  group_by:
    type: string
    required: false
    description: 'Aggregation level: `reason`, `product`, `sku`, or `reason_x_product`'
  min_returns:
    type: number
    required: false
    description: Minimum returns per group to include in summary
  writeoff_reasons:
    type: string
    required: false
    description: >-
      Return reasons whose items are treated as non-restockable (full COGS
      write-off)
  flat_restocking_cost:
    type: number
    required: false
    description: Average labor cost per return line item to model restocking workload
---
## Purpose
Quantifies the full cost of returns over a window — not just the refunded amount. Combines refund totals, lost shipping revenue, COGS for non-restockable items (e.g., `DEFECTIVE`), and restocking labor into a per-reason and per-product return P&L. Read-only. Use to prioritize which reasons or product lines deserve operational fixes — better packaging, size guides, listing accuracy.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| format | string | no | human | Output format: `human` or `json` |
| days_back | integer | no | 90 | Lookback window for returns |
| group_by | string | no | reason | Aggregation level: `reason`, `product`, `sku`, or `reason_x_product` |
| min_returns | integer | no | 3 | Minimum returns per group to include in summary |
| writeoff_reasons | array | no | `["DEFECTIVE"]` | Return reasons whose items are treated as non-restockable (full COGS write-off) |
| flat_restocking_cost | float | no | 5.00 | Average labor cost per return line item to model restocking workload |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Cost figures are estimates derived from `unitCost`, refund totals, and `flat_restocking_cost` — calibrate the flat-cost figure to your operation before treating outputs as accounting truth.

## Workflow Steps

1. **OPERATION:** `returns` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select returns with line item pricing, product/variant, `inventoryItem.id`
   **Expected output:** All returns in window with per-line-item pricing

2. **OPERATION:** `orders` — query
   **Inputs:** For each return's `order.id`, fetch `refunds { totalRefundedSet refundLineItems { quantity subtotalSet totalTaxSet lineItem { id } } }`
   **Expected output:** Refund amounts mappable to line items

3. **OPERATION:** `inventoryItems` — query — batch unique `inventoryItem.id` from step 1; returns `unitCost` per item

4. Per line item compute: `refund_amount` (matched refundLineItem proportional to returned qty), `shipping_loss` (order shipping × line-item value share for full-order returns; else 0), `cogs_writeoff` (`unitCost × qty` only if `returnReason in writeoff_reasons`), `restocking_labor` (`flat_restocking_cost × qty`). Sum and aggregate by `group_by`.

## GraphQL Operations

```graphql
# returns:query — validated against api_version 2025-01
query ReturnsForCostAttribution($query: String!, $after: String) {
  returns(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        status
        createdAt
        totalQuantity
        order {
          id
          name
          totalShippingPriceSet { shopMoney { amount currencyCode } }
          totalPriceSet { shopMoney { amount currencyCode } }
        }
        returnLineItems(first: 50) {
          edges { node {
            id
            quantity
            returnReason
            fulfillmentLineItem { lineItem {
              id
              title
              quantity
              discountedTotalSet { shopMoney { amount currencyCode } }
              originalUnitPriceSet { shopMoney { amount currencyCode } }
              variant { id sku inventoryItem { id } }
              product { id title vendor }
            } }
          } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

```graphql
# orders:query — validated against api_version 2025-01
query OrderRefundsForReturns($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        refunds {
          id
          createdAt
          totalRefundedSet { shopMoney { amount currencyCode } }
          refundLineItems(first: 50) {
            edges { node {
              quantity
              subtotalSet { shopMoney { amount currencyCode } }
              totalTaxSet { shopMoney { amount currencyCode } }
              lineItem { id }
            } }
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
query InventoryUnitCosts($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on InventoryItem {
      id
      unitCost { amount currencyCode }
      tracked
    }
  }
}
```

## Output Format
CSV file `return_cost_<YYYY-MM-DD>.csv` with columns:
`group_key`, `return_count`, `units`, `refund_amount`, `shipping_loss`, `cogs_writeoff`, `restocking_labor`, `total_cost`, `avg_cost_per_return`, `top_return_reason`, `currency`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Missing `unitCost` | Cost not recorded | Treat COGS as 0 and flag the row |
| Refund not yet processed | Customer not yet refunded | Use line item discounted total as estimate |
| Multiple refunds per return | Partial refund history | Sum refunds tied to the return's line items |
| No shipping cost | Free shipping | Shipping loss = 0 |

## Best Practices
- Use `group_by: reason_x_product` to surface lethal combos like `DEFECTIVE × <hero SKU>` — supplier-quality issues addressable at the source.
- Re-run after `unitCost` updates; stale cost most often skews COGS write-off.
- Pair with `return-reason-analysis` to compare "what returns most" with "what costs most" — they often diverge.
