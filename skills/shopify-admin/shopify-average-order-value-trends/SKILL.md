---
name: shopify-average-order-value-trends
displayName: Average Order Value Trends
description: >-
  Read-only: tracks AOV over time buckets and segments by new vs. returning
  customers.
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
    description: Total lookback window
  bucket:
    type: string
    required: false
    description: 'Time bucket: `day`, `week`, or `month`'
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Calculates Average Order Value (AOV) over configurable time buckets (daily, weekly, monthly) and segments results by new vs. returning customers. Tracks AOV trends to measure the impact of upsell programs, bundle offers, or free shipping thresholds. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| days_back | integer | no | 90 | Total lookback window |
| bucket | string | no | week | Time bucket: `day`, `week`, or `month` |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `totalPriceSet`, `customer { id, numberOfOrders }`, `createdAt`, pagination cursor
   **Expected output:** All orders in window; paginate until `hasNextPage: false`

2. Classify each order: if `customer.numberOfOrders == 1` → new customer order; else → returning

3. **OPERATION:** `customers` — query (optional enrichment for cohort context)
   **Inputs:** Recent customers for new vs. repeat segmentation validation

4. Group orders by time bucket; calculate AOV per bucket and per customer segment

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query AOVData($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
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
# customers:query — validated against api_version 2025-01
query NewVsReturningCustomers($query: String!, $after: String) {
  customers(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        numberOfOrders
        createdAt
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
CSV file `aov_trends_<YYYY-MM-DD>.csv` with columns:
`period`, `order_count`, `aov`, `new_customer_orders`, `new_customer_aov`, `returning_orders`, `returning_aov`, `currency`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Guest checkout orders | No customer record | Count in totals but exclude from new/returning segmentation |
| No orders in window | New store or quiet period | Exit with 0 AOV |

## Best Practices
- A free shipping threshold increase or bundle introduction should show up as an AOV lift in the week/month it launched — use this report to measure the impact.
- Returning customer AOV is typically higher than new — a shrinking gap may indicate loyalty erosion.
- `bucket: week` is best for campaign measurement; `bucket: month` for long-term trend tracking.
- Guest checkout orders cannot be segmented as new vs. returning — for stores with high guest checkout rates, the segmentation will under-count new customers.
