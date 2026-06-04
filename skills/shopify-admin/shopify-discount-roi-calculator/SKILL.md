---
name: shopify-discount-roi-calculator
displayName: Discount Roi Calculator
description: >-
  Read-only: calculates the true ROI of each discount code and automatic
  discount by comparing incremental revenue against discount cost.
version: 1.0.0
category: conversion-optimization
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
  - conversion-optimization
input:
  days_back:
    type: number
    required: false
    description: Lookback window
  min_uses:
    type: number
    required: false
    description: Minimum uses for a discount to be analyzed
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Evaluates the true return on investment for each discount code and automatic discount by measuring revenue generated, number of orders, average order value with vs. without discount, customer acquisition attributed to discounts, and whether discounted orders cannibalized full-price sales. Goes beyond `discount-hygiene-cleanup` (which finds broken/unused codes) to answer "was this discount worth it?" Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| days_back | integer | no | 90 | Lookback window |
| min_uses | integer | no | 3 | Minimum uses for a discount to be analyzed |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `discountNodes` — query
   **Inputs:** `first: 250`, select discount details (title, code, type, value, usageCount, startsAt, endsAt), pagination cursor
   **Expected output:** All discount codes and automatic discounts

2. Filter to discounts with `usageCount >= min_uses` and active within lookback window

3. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>' discount_code:<code>"`, `first: 250` for each active discount code, select `totalPriceSet`, `totalDiscountsSet`, `subtotalPriceSet`, `customer { id, numberOfOrders }`, pagination cursor
   **Expected output:** All orders using each discount

4. Also query orders WITHOUT any discount in same period for baseline AOV comparison

5. For each discount, calculate:
   - **Total Discount Cost** = Σ(totalDiscountsSet for orders with this code)
   - **Revenue Generated** = Σ(totalPriceSet for orders with this code)
   - **Discounted AOV** = revenue / orders
   - **Baseline AOV** = AOV of non-discounted orders in same period
   - **AOV Lift/Drop** = discounted AOV - baseline AOV
   - **New Customer %** = orders where customer.numberOfOrders == 1 / total
   - **Gross ROI** = (revenue - discount_cost) / discount_cost × 100
   - **Cannibalization Risk** = high if discount AOV < baseline AOV and new customer % < 20%

## GraphQL Operations

```graphql
# discountNodes:query — validated against api_version 2025-01
query AllDiscounts($after: String) {
  discountNodes(first: 250, after: $after) {
    edges {
      node {
        id
        discount {
          ... on DiscountCodeBasic {
            title
            codes(first: 1) { edges { node { code } } }
            usageLimit
            asyncUsageCount
            startsAt
            endsAt
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
            }
          }
          ... on DiscountCodeFreeShipping {
            title
            codes(first: 1) { edges { node { code } } }
            asyncUsageCount
            startsAt
            endsAt
          }
          ... on DiscountAutomaticBasic {
            title
            asyncUsageCount
            startsAt
            endsAt
            customerGets {
              value {
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } }
              }
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
# orders:query — validated against api_version 2025-01
query OrdersByDiscount($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        totalPriceSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        subtotalPriceSet { shopMoney { amount currencyCode } }
        customer {
          id
          numberOfOrders
        }
        discountCodes
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

## Output Format
CSV file `discount_roi_<YYYY-MM-DD>.csv` with columns:
`discount_id`, `code_or_title`, `type`, `uses`, `revenue`, `discount_cost`, `roi_pct`, `aov`, `baseline_aov`, `aov_delta`, `new_customer_pct`, `cannibalization_risk`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Automatic discounts | No code to query by | Match via order discount data |
| Stacked discounts | Multiple codes per order | Attribute proportionally or flag as "multi-discount" |

## Best Practices
- Discounts with ROI < 100% cost more than they generate — consider retiring them.
- High new-customer % with positive ROI = great acquisition tool — keep running.
- Low new-customer % with negative AOV lift = cannibalization — customers would have bought anyway.
- Cross-reference with `discount-ab-analysis` for split-test insights.
- Use with `discount-hygiene-cleanup` to find and remove underperforming codes.
