---
name: shopify-churn-risk-scorer
displayName: Churn Risk Scorer
description: >-
  Read-only: scores customers by churn probability based on purchase recency,
  frequency decay, and expected repurchase intervals.
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
  days_back:
    type: number
    required: false
    description: Historical window for purchase pattern analysis
  min_orders:
    type: number
    required: false
    description: Minimum orders to calculate purchase interval (need 2+ for frequency)
  risk_threshold:
    type: number
    required: false
    description: Multiplier of avg purchase interval before flagging as at-risk
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Predicts which customers are at risk of churning by analyzing their purchase patterns against their historical buying frequency. Calculates an expected next-purchase date for each repeat customer, then scores churn risk based on how overdue they are. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain |
| days_back | integer | no | 365 | Historical window for purchase pattern analysis |
| min_orders | integer | no | 2 | Minimum orders to calculate purchase interval (need 2+ for frequency) |
| risk_threshold | float | no | 1.5 | Multiplier of avg purchase interval before flagging as at-risk |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Churn Risk Scoring Model

For each customer with `min_orders` or more purchases:

1. **Average Purchase Interval (API)** = total days between first and last order / (order_count - 1)
2. **Days Since Last Order (DSLO)** = today - last_order_date
3. **Overdue Ratio** = DSLO / API
4. **Churn Risk Score** (0-100):
   - Overdue ratio ≤ 1.0 → Score 0-20 (Active)
   - Overdue ratio 1.0–1.5 → Score 20-50 (Cooling)
   - Overdue ratio 1.5–2.5 → Score 50-80 (At Risk)
   - Overdue ratio > 2.5 → Score 80-100 (Likely Churned)
5. **Customer Lifetime Value (CLV)** = total spend / customer age in years × expected remaining years

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `createdAt`, `totalPriceSet`, `customer { id, email, firstName, lastName }`, pagination cursor
   **Expected output:** All orders with customer association

2. Group orders by customer, calculate per customer:
   - Order dates (sorted chronologically)
   - Average purchase interval
   - Days since last order
   - Total spend
   - Order count

3. **OPERATION:** `customers` — query (enrichment)
   **Inputs:** Customer IDs for at-risk and likely-churned segments
   **Expected output:** Contact details, tags, total spend

4. Calculate churn risk score and classify into segments

5. Estimate revenue at risk = sum of (annual_spend × churn_probability) for at-risk customers

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query OrdersForChurnAnalysis($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        createdAt
        totalPriceSet { shopMoney { amount currencyCode } }
        customer {
          id
          email
          firstName
          lastName
          numberOfOrders
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

```graphql
# customers:query — validated against api_version 2025-01
query AtRiskCustomers($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Customer {
      id
      email
      firstName
      lastName
      totalSpentV2 { amount currencyCode }
      numberOfOrders
      tags
      createdAt
    }
  }
}
```

## Output Format
CSV file `churn_risk_<YYYY-MM-DD>.csv` with columns:
`customer_id`, `email`, `first_name`, `last_name`, `order_count`, `total_spent`, `avg_purchase_interval_days`, `days_since_last_order`, `overdue_ratio`, `churn_risk_score`, `risk_segment`, `expected_annual_value`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Single-purchase customers | Can't calculate interval | Exclude from scoring (need 2+ orders) |
| Guest orders | No customer linkage | Skip — cannot build customer profile |

## Best Practices
- Pair with `customer-win-back` skill to take action on At-Risk and Likely Churned segments.
- Use with `rfm-customer-segmentation` for a more holistic view of customer health.
- High-value churning customers (top 20% by spend) should get personalized outreach.
- Export At-Risk segment to email marketing platform for automated win-back sequences.
- Adjust `risk_threshold` based on your product type: consumables (1.3), fashion (1.5), furniture (2.0).
