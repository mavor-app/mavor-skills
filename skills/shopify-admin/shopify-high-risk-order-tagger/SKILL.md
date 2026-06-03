---
name: shopify-high-risk-order-tagger
displayName: High Risk Order Tagger
description: >-
  Tags orders flagged as high-risk for manual review and optionally places
  fulfillment holds to prevent shipping.
version: 1.0.0
category: order-intelligence
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
  - order-intelligence
  - mutation
input:
  days_back:
    type: number
    required: false
    description: 'Lookback window (default: last 24 hours)'
  min_order_value:
    type: number
    required: false
    description: Only flag orders above this value
  tag:
    type: string
    required: false
    description: Tag applied to flagged orders
  hold_fulfillment:
    type: boolean
    required: false
    description: Also place a fulfillment hold on flagged orders
  hold_reason:
    type: string
    required: false
    description: Fulfillment hold reason
  dry_run:
    type: boolean
    required: false
    description: Preview without executing mutations
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Queries recent high-risk orders and takes two protective actions: tags the order for staff visibility and optionally places a fulfillment hold to prevent the order from shipping until reviewed. Complements `order-risk-report` (which only reads) with write actions that create a reviewable queue.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| days_back | integer | no | 1 | Lookback window (default: last 24 hours) |
| min_order_value | float | no | 0 | Only flag orders above this value |
| tag | string | no | fraud-review | Tag applied to flagged orders |
| hold_fulfillment | bool | no | true | Also place a fulfillment hold on flagged orders |
| hold_reason | string | no | UNKNOWN_PAYMENT_RISK | Fulfillment hold reason |
| dry_run | bool | no | true | Preview without executing mutations |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ⚠️ `fulfillmentOrderHold` prevents orders from being fulfilled until the hold is explicitly released. Customers will experience a shipping delay while on hold. Use `hold_fulfillment: false` if you only want to tag without blocking fulfillment. Run with `dry_run: true` to confirm the order list before committing. Release holds with the `order-hold-and-release` skill after review.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "risk_level:high created_at:>='<NOW - days_back days>'"`, `first: 250`, select `riskLevel`, `fulfillmentOrders`, `totalPriceSet`
   **Expected output:** High-risk orders in window

2. **OPERATION:** `tagsAdd` — mutation
   **Inputs:** Order `id`, `tags: [<tag>]`
   **Expected output:** Updated order tags; `userErrors`

3. **OPERATION:** `fulfillmentOrderHold` — mutation (if `hold_fulfillment: true`)
   **Inputs:** `fulfillmentOrderId`, `reason: <hold_reason>`, `reasonNotes: "High-risk order — awaiting fraud review"`
   **Expected output:** `heldFulfillmentOrder { id, status }`, `userErrors`

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query HighRiskOrders($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        riskLevel
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        tags
        fulfillmentOrders(first: 5) {
          edges {
            node {
              id
              status
            }
          }
        }
        customer {
          id
          displayName
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
# tagsAdd:mutation — validated against api_version 2025-01
mutation TagsAdd($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node {
      id
    }
    userErrors {
      field
      message
    }
  }
}
```

```graphql
# fulfillmentOrderHold:mutation — validated against api_version 2025-01
mutation FulfillmentOrderHold($id: ID!, $fulfillmentHold: FulfillmentOrderHoldInput!) {
  fulfillmentOrderHold(id: $id, fulfillmentHold: $fulfillmentHold) {
    fulfillmentOrder {
      id
      status
    }
    userErrors {
      field
      message
    }
  }
}
```

## Output Format
CSV file `risk_tagging_<YYYY-MM-DD>.csv` with columns:
`order_name`, `order_id`, `risk_level`, `total_price`, `currency`, `tag_applied`, `hold_placed`, `customer_name`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `userErrors` on hold | Order already fulfilled or hold already exists | Log as skipped, continue |
| No high-risk orders | Clean period | Exit with 0 flagged |

## Best Practices
- Run within 1–2 hours of order placement — most fraud orders are placed and expected to ship same-day.
- After a hold is placed, use `order-risk-report` to review the risk indicators in detail before deciding to cancel or release.
- Release legitimate orders with the `order-hold-and-release` skill to minimize shipping delay.
- Orders from repeat customers (`numberOfOrders > 3`) are unlikely to be fraudulent — consider filtering them out with `min_order_value` or a separate query.
