---
name: shopify-customer-win-back
displayName: Customer Win Back
description: >-
  Identify customers who have not ordered in N days, export a re-engagement
  list, and tag them in Shopify.
version: 1.0.0
category: marketing
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
  - marketing
  - mutation
input:
  format:
    type: string
    required: false
    description: '`human` or `json`'
  dry_run:
    type: boolean
    required: false
    description: Preview without tagging
  inactive_days:
    type: number
    required: false
    description: Days since last order to qualify as lapsed
  min_orders:
    type: number
    required: false
    description: Minimum lifetime order count to include
  tag:
    type: string
    required: false
    description: Tag applied to lapsed customers
  max_customers:
    type: number
    required: false
    description: Maximum customers to process per run
---
## Purpose
Segments lapsed customers — those who placed at least one order but have not purchased again within a configurable window — and tags them for re-engagement. This skill handles the Shopify-native data layer; sending re-engagement emails requires an external tool.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain |
| format | string | no | human | `human` or `json` |
| dry_run | bool | no | false | Preview without tagging |
| inactive_days | integer | no | 90 | Days since last order to qualify as lapsed |
| min_orders | integer | no | 1 | Minimum lifetime order count to include |
| tag | string | no | win-back | Tag applied to lapsed customers |
| max_customers | integer | no | 500 | Maximum customers to process per run |

## Workflow Steps

1. **OPERATION:** `customers` — query
   **Inputs:** filter `last_order_date:<(NOW - inactive_days days)`, `orders_count:>=(min_orders)`, `first: 250`, pagination
   **Expected output:** List of customer objects with `id`, `defaultEmailAddress { emailAddress }`, `firstName`, `lastName`, `ordersCount`, `lastOrder.processedAt`; paginate until `hasNextPage: false`

2. **OPERATION:** `tagsAdd` — mutation
   **Inputs:** Customer `id`, tag string from `tag` parameter
   **Expected output:** Confirmation per customer; collect `userErrors`

## GraphQL Operations

```graphql
# customers:query — validated against api_version 2025-04
query LapsedCustomers($first: Int!, $after: String, $query: String) {
  customers(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        defaultEmailAddress {
          emailAddress
        }
        firstName
        lastName
        ordersCount
        lastOrder {
          processedAt
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
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

## Output Format
CSV `winback_<YYYY-MM-DD>.csv` with columns:
`customer_id`, `email`, `first_name`, `last_name`, `orders_count`, `last_order_date`, `tag_applied`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | Rate limit | Wait 2s, retry up to 3 times |
| `userErrors` on tagsAdd | Customer not found or invalid ID | Log, skip, continue |

## Best Practices
- Use a dated tag (e.g., `win-back-2026-04`) so you can track which cohort was targeted each month and avoid re-tagging customers who already received a win-back campaign.
- Set `min_orders: 2` to focus on customers who had a genuine purchase relationship, not one-time buyers who may never have intended to return.
- Run with `dry_run: true` first to validate the lapsed customer count before tagging — the count informs the scale of your re-engagement campaign.
