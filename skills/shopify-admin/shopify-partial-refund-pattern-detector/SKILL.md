---
name: shopify-partial-refund-pattern-detector
displayName: Partial Refund Pattern Detector
description: >-
  Read-only: surfaces orders with multiple partial refunds or unusually high
  partial-refund-to-total ratios that may indicate fraud, chronic complaints, or
  process gaps.
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
    description: Lookback window for orders to analyze
  min_partials:
    type: number
    required: false
    description: Minimum number of partial refunds to flag an order
  ratio_threshold:
    type: number
    required: false
    description: >-
      Flag orders where total refunded / order total exceeds this ratio (still
      partial, i.e. below 1.0)
  min_order_value:
    type: number
    required: false
    description: Skip low-value orders below this amount
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Scans recent orders, extracts every refund, and flags orders that have either (a) two or more partial refunds, or (b) a partial-refund-to-order-total ratio above a configurable threshold. These patterns frequently indicate friendly fraud (incremental claims), an unhappy repeat customer pattern, or a staff workflow gap (refunding piecemeal instead of issuing one full credit). Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| days_back | integer | no | 90 | Lookback window for orders to analyze |
| min_partials | integer | no | 2 | Minimum number of partial refunds to flag an order |
| ratio_threshold | float | no | 0.5 | Flag orders where total refunded / order total exceeds this ratio (still partial, i.e. below 1.0) |
| min_order_value | float | no | 25 | Skip low-value orders below this amount |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time. Flagged orders are advisory — confirm with refund notes and customer history before taking action against a customer account.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>' financial_status:partially_refunded"`, `first: 250`, select `refunds { id, createdAt, totalRefundedSet, note }`, `totalPriceSet`, `customer`, pagination cursor
   **Expected output:** All partially refunded orders with full refund history; paginate until `hasNextPage: false`

2. For each order, count refunds and sum `totalRefundedSet.shopMoney.amount`. Compute `ratio = total_refunded / order_total`.

3. Flag orders meeting either condition: `refund_count >= min_partials` OR `ratio >= ratio_threshold` (and `ratio < 1.0` so fully refunded orders are excluded).

4. Group flagged orders by `customer.id` to surface repeat-offender customers (more than one flagged order in the window).

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query PartialRefundPatterns($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        displayFinancialStatus
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        totalRefundedSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        refunds {
          id
          createdAt
          note
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
                  id
                  title
                  sku
                }
              }
            }
          }
        }
        customer {
          id
          displayName
          defaultEmailAddress {
            emailAddress
          }
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

## Output Format
CSV file `partial_refund_patterns_<YYYY-MM-DD>.csv` with columns:
`order_name`, `order_id`, `customer_email`, `customer_lifetime_orders`, `order_total`, `total_refunded`, `refund_ratio`, `refund_count`, `flag_reason`, `first_refund_at`, `last_refund_at`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Order has refund but `totalRefundedSet` is zero | Refund recorded as $0 (note only, no money moved) | Skip from ratio calc, count refund |
| Customer is null (guest order) | No customer attached | Group by email instead of customer ID |
| No partially refunded orders | Clean window | Exit with summary: 0 flagged |

## Best Practices
- Combine `min_partials: 2` and `ratio_threshold: 0.5` for the most useful signal — single small partial refunds are usually legitimate.
- Sort by `refund_ratio` descending: high ratios on high-value orders are the strongest fraud signal.
- A repeat-flagged customer with `numberOfOrders > 5` is often a chronic complainer, not a fraudster — review the refund notes before action.
- Use this skill quarterly alongside `order-risk-report` to detect post-purchase fraud that fraud filters miss at checkout.
- Refund `note` content frequently reveals the pattern (e.g., "item missing" repeated three times) — read the notes before flagging a customer.
