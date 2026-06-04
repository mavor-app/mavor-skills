---
name: shopify-discount-ab-analysis
displayName: Discount Ab Analysis
description: >-
  Compare redemption rates and revenue performance across two or more discount
  codes over a specified date range.
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
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
  dry_run:
    type: boolean
    required: false
    description: Preview operations without executing mutations
  discount_codes:
    type: string
    required: true
    description: >-
      Array of 2 or more discount code strings to compare (e.g., `["SAVE10",
      "WELCOME15"]`)
  date_range_start:
    type: string
    required: true
    description: 'Start date in ISO 8601 (e.g., `2025-01-01`)'
  date_range_end:
    type: string
    required: true
    description: 'End date in ISO 8601 (e.g., `2025-01-31`)'
---
## Purpose
Compares how different discount codes perform against each other by redemption count and revenue generated. Useful for A/B testing promotional offers without a dedicated analytics app — provide two or more codes and a date range, and the skill queries Shopify for discount metadata and order revenue, then produces a side-by-side comparison table. Read-only: no mutations are executed.

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
| discount_codes | array | yes | — | Array of 2 or more discount code strings to compare (e.g., `["SAVE10", "WELCOME15"]`) |
| date_range_start | string | yes | — | Start date in ISO 8601 (e.g., `2025-01-01`) |
| date_range_end | string | yes | — | End date in ISO 8601 (e.g., `2025-01-31`) |

## Workflow Steps

1. **OPERATION:** `discountNodes` — query
   **Inputs:** `first: 50`, `query: "code:<code>"` (one query per code in `discount_codes`)
   **Expected output:** Discount metadata: title, code strings, `asyncUsageCount`, status, `startsAt`, `endsAt` per code

2. **OPERATION:** `orders` — query (one paginated query per discount code)
   **Inputs:** `first: 250`, `query: "discount_code:<code> created_at:>='<date_range_start>' created_at:<='<date_range_end>'"`, pagination cursor
   **Expected output:** Orders containing the discount code with `totalPriceSet`; paginate until `hasNextPage: false`; aggregate: count, sum revenue, compute avg order value

## GraphQL Operations

```graphql
# discountNodes:query — validated against api_version 2025-01
query DiscountNodes($first: Int!, $query: String) {
  discountNodes(first: $first, query: $query) {
    edges {
      node {
        id
        discount {
          ... on DiscountCodeBasic {
            title
            codes(first: 10) {
              edges {
                node {
                  code
                  asyncUsageCount
                }
              }
            }
            usageLimit
            status
            startsAt
            endsAt
          }
          ... on DiscountCodeBxgy {
            title
            codes(first: 10) {
              edges {
                node {
                  code
                  asyncUsageCount
                }
              }
            }
            status
          }
          ... on DiscountCodeFreeShipping {
            title
            codes(first: 10) {
              edges {
                node {
                  code
                  asyncUsageCount
                }
              }
            }
            status
          }
        }
      }
    }
  }
}
```

```graphql
# orders:query (by discount code) — validated against api_version 2025-01
query OrdersByDiscountCode($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        createdAt
        totalPriceSet {
          shopMoney { amount currencyCode }
        }
        discountCodes
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

A comparison table per code (displayed inline):

| Code | Uses (asyncUsageCount) | Orders in Range | Total Revenue | Avg Order Value | Revenue per Use |
|------|------------------------|-----------------|---------------|-----------------|-----------------|
| SAVE10 | ... | ... | ... | ... | ... |
| WELCOME15 | ... | ... | ... | ... | ... |

For `format: json`, the `results` array contains one object per code with keys: `code`, `async_usage_count`, `orders_in_range`, `total_revenue`, `avg_order_value`, `revenue_per_use`.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| Discount code not found | Code doesn't exist or was deleted | Verify code in Shopify admin |
| No orders returned for a code | No orders used this code in the date range | Widen date range or verify code was active |
| `discount_codes` has fewer than 2 entries | Can't do A/B with 1 code | Provide at least 2 codes |
| Rate limit (429) | Too many paginated orders queries | Wait and retry; reduce date range |

## Best Practices
1. `asyncUsageCount` is the lifetime usage count from the discount object — `orders_in_range` is what was redeemed in your date window. Both are reported for full context.
2. For codes with high usage, the orders query will paginate — larger date ranges may produce many API calls. Consider narrowing the date range for faster results.
3. Revenue per use is the best signal for comparing codes with different usage volumes.
4. Run this analysis at the end of a campaign period before deciding which discount strategy to repeat.
5. If `asyncUsageCount` is 0 for a code, check that the code was active during the date range and correctly applied at checkout.
