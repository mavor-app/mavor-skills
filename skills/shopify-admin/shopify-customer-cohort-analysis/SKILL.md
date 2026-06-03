---
name: shopify-customer-cohort-analysis
displayName: Customer Cohort Analysis
description: >-
  Read-only: groups customers by first-purchase month and tracks repeat purchase
  rate and revenue per cohort.
version: 1.0.0
category: customer-ops
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
  - customer-ops
input:
  cohort_months:
    type: number
    required: false
    description: Number of months of cohorts to analyze
  follow_months:
    type: number
    required: false
    description: Number of months to follow each cohort after acquisition
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Groups customers by the month of their first purchase and tracks how each cohort performs over time: how many customers repurchase, how many orders they place, and how much revenue each cohort generates in subsequent months. Cohort analysis is the gold standard for measuring retention and the health of a subscription or loyalty program. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| cohort_months | integer | no | 6 | Number of months of cohorts to analyze |
| follow_months | integer | no | 3 | Number of months to follow each cohort after acquisition |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `customers` — query
   **Inputs:** `query: "created_at:>='<NOW - cohort_months months>'"`, `first: 250`, select `id`, `createdAt`, `numberOfOrders`, pagination cursor
   **Expected output:** Customers acquired in the cohort window

2. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - cohort_months + follow_months months>'"`, `first: 250`, select `customer { id }`, `createdAt`, `totalPriceSet`, pagination cursor
   **Expected output:** All orders to build per-customer purchase timeline

3. Group customers by first-order month (cohort); for each cohort, calculate repeat purchase rate and total revenue in months 1, 2, 3+

## GraphQL Operations

```graphql
# customers:query — validated against api_version 2025-01
query CohortCustomers($query: String!, $after: String) {
  customers(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        createdAt
        numberOfOrders
        amountSpent {
          amount
          currencyCode
        }
        defaultEmailAddress {
          emailAddress
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
# orders:query — validated against api_version 2025-01
query CohortOrders($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        createdAt
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        customer {
          id
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
CSV file `cohort_analysis_<YYYY-MM-DD>.csv` with columns:
`cohort_month`, `customers_acquired`, `repeat_purchasers`, `repeat_rate_pct`, `total_revenue`, `revenue_per_customer`, `month_offset`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Insufficient history | Store newer than cohort window | Analyze available months only |
| Guest checkout orders | No customer record | Exclude from cohort tracking |

## Best Practices
- A healthy ecommerce business typically sees 20–40% of first-month customers repeat within 90 days — use this as a benchmark.
- Declining repeat rates in recent cohorts may signal product quality issues, CX friction, or increased competition.
- Use `follow_months: 6` for subscription-oriented businesses where the repeat window is longer.
- Pair with `customer-spend-tier-tagger` — customers from high-repeat cohorts are your best candidates for the Gold/Platinum tier.
