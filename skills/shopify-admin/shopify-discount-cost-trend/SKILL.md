---
name: shopify-discount-cost-trend
displayName: Discount Cost Trend
description: >-
  Read-only: tracks total discount dollars given over configurable time buckets
  (week/month/quarter), broken down by discount type and code.
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
  period:
    type: string
    required: false
    description: 'Bucket size: `week`, `month`, or `quarter`'
  periods_back:
    type: number
    required: false
    description: Number of buckets to report
  top_codes:
    type: number
    required: false
    description: Top discount codes to break out individually; remainder grouped as `other`
  include_shipping_discounts:
    type: boolean
    required: false
    description: Whether to count shipping discounts in the totals
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Tracks how much money the store gave away in discounts over time, bucketed by week, month, or quarter, and broken down by discount code and discount type (percentage / fixed amount / free shipping / automatic). Answers: "is our discount spend trending up or down, and which campaigns are driving it?" Read-only — no mutations. Complements `discount-roi-calculator` (per-discount return) with a longitudinal view of total cost.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| period | string | no | month | Bucket size: `week`, `month`, or `quarter` |
| periods_back | integer | no | 12 | Number of buckets to report |
| top_codes | integer | no | 10 | Top discount codes to break out individually; remainder grouped as `other` |
| include_shipping_discounts | bool | no | true | Whether to count shipping discounts in the totals |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. Compute window from `period` × `periods_back` (e.g., `month` × 12 → last 12 calendar months starting from the first day of the bucket 11 months ago)

2. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<window_start>' financial_status:paid"`, `first: 250`, select `createdAt`, `discountCodes`, `currentTotalDiscountsSet`, `totalDiscountsSet`, `cartDiscountAmountSet`, `discountApplications { allocationMethod, targetType, value, ... on DiscountCodeApplication { code }, ... on AutomaticDiscountApplication { title }, ... on ManualDiscountApplication { title } }`, `shippingLines { discountAllocations { allocatedAmountSet } }`, pagination cursor
   **Expected output:** All paid orders in the window with discount data; paginate until `hasNextPage: false`

3. For each order, attribute discount cost:
   - `cart_discount` = `currentTotalDiscountsSet.shopMoney.amount`
   - `shipping_discount` = sum of `shippingLines.discountAllocations.allocatedAmountSet` (only if `include_shipping_discounts: true`)
   - `total_discount` = cart_discount + shipping_discount
   - Attribute by code: prefer first `discountApplications.code` for code discounts, `title` for automatic / manual

4. Bucket each order into its period (week-of-year, year-month, or year-quarter) and aggregate:
   - Total discount cost per bucket
   - Per discount code per bucket
   - Per discount type per bucket (percentage, fixed_amount, shipping, automatic)

5. Identify top codes by total cost across the window; aggregate the rest as `other`

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query DiscountCostTrend($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        discountCodes
        currentTotalDiscountsSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        cartDiscountAmountSet { shopMoney { amount currencyCode } }
        discountApplications(first: 10) {
          edges {
            node {
              allocationMethod
              targetType
              targetSelection
              value {
                ... on PricingPercentageValue { percentage }
                ... on MoneyV2 { amount currencyCode }
              }
              ... on DiscountCodeApplication { code }
              ... on AutomaticDiscountApplication { title }
              ... on ManualDiscountApplication { title description }
            }
          }
        }
        shippingLines(first: 5) {
          edges {
            node {
              title
              discountAllocations {
                allocatedAmountSet { shopMoney { amount currencyCode } }
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

## Output Format
CSV file `discount_cost_trend_<YYYY-MM-DD>.csv` with columns:
`bucket`, `discount_code_or_title`, `discount_type`, `orders_count`, `cart_discount`, `shipping_discount`, `total_discount`, `currency`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Stacked discount codes | Multiple codes on one order | Attribute proportionally to each code by their `value` share, or label as `multi-code` if equal |
| Manual discount with no title | Cashier-entered with empty title | Group as `manual:untitled` |
| Multi-currency orders | Presentment currency != shop currency | Sum on `shopMoney.amount` (shop currency) for consistency |

## Best Practices
- Use `period: week` for promotional businesses with frequent campaigns; `period: month` for stores with steady evergreen offers; `period: quarter` for board reporting.
- A flat or rising trend with no campaign activity often points to **automatic discount creep** — review automatic discounts that have no end date.
- Cross-reference the latest bucket against `discount-roi-calculator` to verify the cost increase is producing matching incremental revenue.
- Set `include_shipping_discounts: false` if your accounting books shipping subsidy separately from product discounts.
- Set up monthly automation: discount spend that drifts above budget should trigger a finance review before it shows up in margin reports.
