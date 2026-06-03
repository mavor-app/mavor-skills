---
name: shopify-refund-rate-analysis
displayName: Refund Rate Analysis
description: >-
  Read-only: calculates refund rate by product, collection, or period —
  identifies quality and listing issues.
version: 1.0.0
category: finance
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
  - finance
input:
  days_back:
    type: number
    required: false
    description: Lookback window
  group_by:
    type: string
    required: false
    description: 'Breakdown: `product`, `vendor`, or `period`'
  min_orders:
    type: number
    required: false
    description: Minimum orders per group to include in rate calculation
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Analyzes orders with refunds to calculate refund rates by product, time period, and channel. Surfaces which products or product groups generate the most refund activity. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| days_back | integer | no | 30 | Lookback window |
| group_by | string | no | product | Breakdown: `product`, `vendor`, or `period` |
| min_orders | integer | no | 5 | Minimum orders per group to include in rate calculation |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `refunds { refundLineItems }`, `lineItems`, pagination cursor
   **Expected output:** All orders with refund data; paginate until `hasNextPage: false`

2. For each refunded line item: record product, vendor, quantity refunded, refund amount

3. Aggregate by `group_by`: calculate `refund_rate = refunded_units / total_units_sold × 100`

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query OrdersWithRefunds($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        lineItems(first: 50) {
          edges {
            node {
              id
              quantity
              product {
                id
                title
                vendor
              }
              variant {
                id
                sku
              }
            }
          }
        }
        refunds {
          id
          createdAt
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          refundLineItems(first: 50) {
            edges {
              node {
                quantity
                lineItem {
                  product {
                    id
                    title
                    vendor
                  }
                  variant {
                    id
                    sku
                  }
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

## Output Format
CSV file `refund_rate_<YYYY-MM-DD>.csv` with columns:
`group`, `group_name`, `total_units_sold`, `refunded_units`, `refund_rate_pct`, `total_refund_amount`, `currency`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No refunds in window | Clean period | Exit with 0% rate, expected |
| Deleted product on refund line | Product removed after refund | Log as "deleted product" in group |

## Best Practices
- A refund rate above 5–10% on specific products typically signals a listing, quality, or expectation mismatch issue.
- Use `group_by: vendor` to identify if quality problems are concentrated with a specific supplier.
- Cross-reference high-refund products with `return-reason-analysis` to understand whether the issue is product quality, wrong size, or customer expectation.
- Run before quarterly supplier reviews to support data-driven conversations about product quality and chargebacks.
