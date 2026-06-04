---
name: shopify-rfm-customer-segmentation
displayName: Rfm Customer Segmentation
description: >-
  Read-only: scores every customer on Recency, Frequency, and Monetary value to
  segment them into actionable groups (Champions, Loyal, At-Risk, Lost).
version: 1.0.0
category: customer-ops
runtime:
  type: llm
  executor: auto
capabilities:
  tools:
    - shopify_graphql_query
  permissions:
    - shop.price.update
    - shop.read
tags:
  - shopify
  - customer-ops
  - mutation
input:
  days_back:
    type: number
    required: false
    description: Lookback window for order history
  segments:
    type: number
    required: false
    description: Number of quintile buckets per dimension (3 or 5)
  min_orders:
    type: number
    required: false
    description: Minimum orders for a customer to be scored
  tag_customers:
    type: boolean
    required: false
    description: 'If true, add RFM segment tag to customer (requires write_customers scope)'
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Performs full RFM (Recency, Frequency, Monetary) analysis across the entire customer base. Each customer is scored 1-5 on three dimensions — how recently they purchased, how often they purchase, and how much they spend — then classified into actionable segments: Champions, Loyal Customers, Potential Loyalists, At-Risk, Hibernating, and Lost. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| days_back | integer | no | 365 | Lookback window for order history |
| segments | integer | no | 5 | Number of quintile buckets per dimension (3 or 5) |
| min_orders | integer | no | 1 | Minimum orders for a customer to be scored |
| tag_customers | boolean | no | false | If true, add RFM segment tag to customer (requires write_customers scope) |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only by default. If `tag_customers: true`, will add tags via customerUpdate mutation — use `dry_run: true` first.

## RFM Segment Definitions

| Segment | R Score | F Score | M Score | Description |
|---------|---------|---------|---------|-------------|
| Champions | 5 | 5 | 5 | Best customers — recent, frequent, high spend |
| Loyal Customers | 3-5 | 4-5 | 4-5 | Consistent buyers with strong spend |
| Potential Loyalists | 4-5 | 2-3 | 2-3 | Recent buyers who could become loyal |
| New Customers | 5 | 1 | 1-2 | Just made first purchase |
| Promising | 4 | 1-2 | 1-2 | Recent but low frequency — nurture them |
| Need Attention | 3 | 3 | 3 | Average across all dimensions — slipping |
| About to Sleep | 2-3 | 2 | 2 | Below average recency and frequency |
| At Risk | 1-2 | 4-5 | 4-5 | Were great customers, haven't bought recently |
| Hibernating | 1-2 | 1-2 | 1-3 | Low on all dimensions — nearly lost |
| Lost | 1 | 1-2 | 1-5 | Haven't bought in a very long time |

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `createdAt`, `totalPriceSet`, `customer { id, email, firstName, lastName, numberOfOrders }`, pagination cursor
   **Expected output:** All orders in window with customer linkage; paginate until complete

2. Aggregate per customer:
   - **Recency** = days since last order
   - **Frequency** = total number of orders in window
   - **Monetary** = total spend in window

3. Score each dimension 1-5 using quintile bucketing:
   - Sort all customers by each metric
   - Divide into N equal-sized groups (quintiles)
   - Assign scores (5 = best for recency [most recent], frequency [most frequent], monetary [highest spend])

4. Map (R, F, M) score combination to named segment using the definitions above

5. **OPERATION:** `customers` — query (enrichment)
   **Inputs:** Customer IDs from each segment for contact details
   **Expected output:** Email, name, tags for top customers in each segment

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query OrdersForRFM($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
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
query CustomerDetails($query: String, $after: String) {
  customers(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        email
        firstName
        lastName
        numberOfOrders
        totalSpentV2 { amount currencyCode }
        tags
        createdAt
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

## Output Format
CSV file `rfm_segments_<YYYY-MM-DD>.csv` with columns:
`customer_id`, `email`, `first_name`, `last_name`, `recency_days`, `frequency`, `monetary`, `r_score`, `f_score`, `m_score`, `rfm_segment`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Guest orders | Orders without customer | Skip — cannot attribute to RFM profile |
| Single-order customers | New or one-time buyers | Include with F=1; they'll naturally score low on frequency |

## Best Practices
- Use `days_back: 365` for most stores to capture seasonal buying patterns. Use `days_back: 180` for fast-fashion or consumables.
- Champions and Loyal segments are ideal targets for exclusive offers and early access campaigns.
- At-Risk customers should receive win-back campaigns immediately — use with `customer-win-back` skill.
- Export Lost segment to an exclusion list to stop wasting ad spend on them.
- Cross-reference with `customer-cohort-analysis` for cohort-level RFM trends over time.
- Use with `customer-spend-tier-tagger` to auto-tag customers based on RFM segment.
