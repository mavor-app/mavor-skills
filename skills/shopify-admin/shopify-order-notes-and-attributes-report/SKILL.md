---
name: shopify-order-notes-and-attributes-report
displayName: Order Notes And Attributes Report
description: >-
  Read-only: extracts and tabulates order notes and custom attributes for ops
  review of gift messages and special instructions.
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
    description: 'Lookback window (default: last 24 hours for daily ops use)'
  attribute_keys:
    type: string
    required: false
    description: >-
      Specific line item attribute keys to extract (e.g., `["gift_message",
      "engraving"]`); empty = all
  only_with_notes:
    type: boolean
    required: false
    description: Only include orders that have a note or attributes
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Queries recent orders and extracts order-level notes and custom line item attributes (e.g., gift messages, personalization text, special instructions, engraving text). Produces a report for ops and fulfillment teams to act on special requests during pick/pack. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| days_back | integer | no | 1 | Lookback window (default: last 24 hours for daily ops use) |
| attribute_keys | array | no | [] | Specific line item attribute keys to extract (e.g., `["gift_message", "engraving"]`); empty = all |
| only_with_notes | bool | no | false | Only include orders that have a note or attributes |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `note`, `customAttributes`, `lineItems { customAttributes }`, pagination cursor
   **Expected output:** Orders with notes and custom attributes; paginate until `hasNextPage: false`

2. If `only_with_notes: true`: filter to orders with non-empty `note` or non-empty `customAttributes`

3. If `attribute_keys` specified: filter line item attributes to matching keys only

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query OrderNotesAndAttributes($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        displayFulfillmentStatus
        note
        customAttributes {
          key
          value
        }
        lineItems(first: 20) {
          edges {
            node {
              id
              title
              quantity
              variant {
                sku
              }
              customAttributes {
                key
                value
              }
            }
          }
        }
        shippingAddress {
          firstName
          lastName
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
CSV file `order_notes_<YYYY-MM-DD>.csv` with columns:
`order_name`, `order_id`, `created_at`, `fulfillment_status`, `customer_name`, `order_note`, `line_item_title`, `line_sku`, `attribute_key`, `attribute_value`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No orders with notes | Quiet period or no note collection | Exit with 0 results if `only_with_notes: true` |

## Best Practices
- Run at the start of each fulfillment shift (e.g., `days_back: 1`) so pickers/packers have a printed list of special instructions before starting.
- Use `attribute_keys: ["gift_message"]` to focus on just gift orders during holiday season.
- Orders with both a note and line item attributes indicate high-touch fulfillment needs — flag these for senior staff review.
- Print or export the CSV and attach to the pick list for efficient special handling during fulfillment.
