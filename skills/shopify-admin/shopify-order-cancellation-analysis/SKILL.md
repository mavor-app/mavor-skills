---
name: shopify-order-cancellation-analysis
displayName: Order Cancellation Analysis
description: >-
  Read-only: tracks cancellation rate over time and breaks down cancelled orders
  by cancelReason to surface fraud, inventory, customer, and declined-payment
  patterns.
version: 1.0.0
category: order-intelligence
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
  - order-intelligence
input:
  days_back:
    type: number
    required: false
    description: Lookback window for orders included in the analysis
  bucket:
    type: string
    required: false
    description: 'Time bucket: `day`, `week`, or `month`'
  min_value:
    type: number
    required: false
    description: Only include orders above this total value
  reason_filter:
    type: string
    required: false
    description: Optional filter to a single `cancelReason`
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Computes cancellation rate (cancelled orders / total orders) over a configurable window, broken down by `cancelReason` (`CUSTOMER`, `FRAUD`, `INVENTORY`, `DECLINED`, `OTHER`, `STAFF`). Surfaces shifts in cancellation patterns — for example, a spike in `INVENTORY` cancellations suggests a stock data integrity problem, while a spike in `FRAUD` suggests a coordinated attack. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| days_back | integer | no | 30 | Lookback window for orders included in the analysis |
| bucket | string | no | day | Time bucket: `day`, `week`, or `month` |
| min_value | float | no | 0 | Only include orders above this total value |
| reason_filter | string | no | — | Optional filter to a single `cancelReason` |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time. The analysis uses `cancelReason` as recorded by Shopify or staff at cancellation time — accuracy depends on staff selecting the correct reason.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `cancelledAt`, `cancelReason`, `displayFinancialStatus`, `totalPriceSet`, pagination cursor
   **Expected output:** All orders created in the window (cancelled and non-cancelled) for rate calculation; paginate until `hasNextPage: false`

2. Partition orders into cancelled (`cancelledAt != null`) and not cancelled. Compute overall rate = cancelled / total.

3. For cancelled orders, group by `cancelReason` and by time bucket. Compute rate per bucket and per reason.

4. Identify time buckets where any single reason exceeds 2x its trailing 7-bucket average — flag as anomalies.

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query OrdersForCancellationAnalysis($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        cancelledAt
        cancelReason
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        customer {
          id
          numberOfOrders
        }
        staffMember {
          id
          name
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
CSV file `cancellation_analysis_<YYYY-MM-DD>.csv` with columns:
`bucket_start`, `bucket_end`, `total_orders`, `cancelled_orders`, `rate_pct`, `reason_customer`, `reason_fraud`, `reason_inventory`, `reason_declined`, `reason_other`, `lost_revenue`, `currency`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `cancelReason` is null on cancelled order | Older order pre-dating reason field | Bucket into `OTHER`, log count |
| No orders in window | Empty store or test domain | Exit with summary: 0 orders, 0% rate |
| Cancelled order created outside window | Cancellation happened in window but order older | Excluded by design — analyses creation cohort |

## Best Practices
- A baseline cancellation rate of 1–3% is typical; spikes above 5% warrant investigation.
- Sustained `INVENTORY` cancellations indicate a sync issue between storefront stock and warehouse — pair this skill with `multi-location-inventory-audit`.
- Sustained `FRAUD` cancellations indicate either improving fraud filters (good) or a coordinated attack (bad) — cross-reference with `order-risk-report`.
- High `DECLINED` rates often correlate with checkout friction or expired payment methods — investigate alongside checkout abandonment data.
- Run weekly to catch reason-mix shifts early; run after every major promotion to confirm cancellations did not spike.
