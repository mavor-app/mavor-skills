---
name: shopify-loyalty-segment-export
displayName: Loyalty Segment Export
description: >-
  Identify high-LTV customers by order count and lifetime spend, tag them, and
  export a loyalty-ready contact list.
version: 1.0.0
category: marketing
runtime:
  type: llm
  executor: auto
capabilities:
  tools:
    - shopify_graphql_query
  permissions:
    - shop.product.write
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
  min_orders:
    type: number
    required: false
    description: Minimum lifetime order count
  min_spend:
    type: number
    required: false
    description: Minimum lifetime spend (store currency)
  tag:
    type: string
    required: false
    description: Tag applied to qualifying customers
---
## Purpose
Segments your highest-value customers by order count and total lifetime spend, tags them in Shopify, and exports a list ready for loyalty program enrollment or VIP campaign targeting. This skill handles the data layer; managing rewards points or sending loyalty emails requires an external tool.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| format | string | no | human | `human` or `json` |
| dry_run | bool | no | false | Preview without tagging |
| min_orders | integer | no | 3 | Minimum lifetime order count |
| min_spend | float | no | 200 | Minimum lifetime spend (store currency) |
| tag | string | no | loyalty-vip | Tag applied to qualifying customers |

## Workflow Steps

1. **OPERATION:** `customers` — query
   **Inputs:** filter `orders_count:>=(min_orders)`, `total_spent:>=(min_spend)`, `first: 250`, pagination
   **Expected output:** List with `id`, `defaultEmailAddress { emailAddress }`, `firstName`, `lastName`, `ordersCount`, `totalSpentV2`; paginate until `hasNextPage: false`

2. **OPERATION:** `tagsAdd` — mutation
   **Inputs:** Customer `id`, tag from `tag` parameter
   **Expected output:** Confirmation per customer; collect `userErrors`

## GraphQL Operations

```graphql
# customers:query — validated against api_version 2025-04
query LoyaltyCustomers($first: Int!, $after: String, $query: String) {
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
        totalSpentV2 {
          amount
          currencyCode
        }
        tags
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
    node { id }
    userErrors { field message }
  }
}
```

## Output Format
CSV `loyalty_segment_<YYYY-MM-DD>.csv` with columns:
`customer_id`, `email`, `first_name`, `last_name`, `orders_count`, `total_spent`, `currency`, `tag_applied`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | Rate limit | Wait 2s, retry up to 3 times |
| `userErrors` on tagsAdd | Invalid customer ID | Log, skip, continue |

## Best Practices
- Before running, check if customers already have the loyalty tag — add `NOT tag:loyalty-vip` to your query filter to skip already-enrolled customers.
- Export and review the customer list before tagging if you're unsure about the threshold values — use `dry_run: true` to see the count, then adjust `min_orders` and `min_spend` before committing.
- Combine with `customer-win-back`: tag high-LTV lapsed customers with both `loyalty-vip` and a win-back tag to identify your highest-priority re-engagement targets.
