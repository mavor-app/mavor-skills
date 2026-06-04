---
name: shopify-order-lookup-and-summary
displayName: Order Lookup And Summary
description: >-
  Retrieve and summarize full order details for a customer by email, order
  number, or phone number.
version: 1.0.0
category: customer-support
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
  - customer-support
input:
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
  dry_run:
    type: boolean
    required: false
    description: Preview operations without executing mutations
  lookup_by:
    type: string
    required: true
    description: '`order_number`, `email`, or `phone`'
  lookup_value:
    type: string
    required: true
    description: >-
      The value to search for (e.g., `#1001`, `jane@example.com`,
      `+15551234567`)
  limit:
    type: number
    required: false
    description: Maximum number of orders to return
---
## Purpose
Retrieves complete order details for a customer without requiring navigation through the Shopify admin UI. Useful for support agents answering customer queries about order status, shipping tracking, and refunds. This skill operates directly on the Shopify-native data layer, returning full order context in a single operation.

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
| lookup_by | string | yes | — | `order_number`, `email`, or `phone` |
| lookup_value | string | yes | — | The value to search for (e.g., `#1001`, `jane@example.com`, `+15551234567`) |
| limit | integer | no | 5 | Maximum number of orders to return |

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `first: <limit>`, `query: "name:<order_number>"` or `"email:<email>"` or `"phone:<phone>"` depending on `lookup_by`
   **Expected output:** Full order objects with financial status, fulfillment status, line items, shipping address, tracking, refunds

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query OrderLookup($first: Int!, $query: String) {
  orders(first: $first, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet {
          shopMoney { amount currencyCode }
        }
        subtotalPriceSet {
          shopMoney { amount currencyCode }
        }
        totalShippingPriceSet {
          shopMoney { amount currencyCode }
        }
        totalRefundedSet {
          shopMoney { amount currencyCode }
        }
        customer {
          id
          defaultEmailAddress {
            emailAddress
          }
          firstName
          lastName
          phone
        }
        shippingAddress {
          address1
          address2
          city
          province
          country
          zip
          phone
        }
        lineItems(first: 50) {
          edges {
            node {
              title
              quantity
              variant {
                sku
                price
              }
              fulfillmentStatus
            }
          }
        }
        fulfillments {
          trackingInfo {
            number
            url
            company
          }
          status
          createdAt
        }
        refunds {
          createdAt
          totalRefundedSet {
            shopMoney { amount currencyCode }
          }
        }
        note
        tags
      }
    }
  }
}
```

## Output Format
Human-readable formatted summary for each order found (not a CSV). For each order, Claude presents: order number, date, financial and fulfillment status, customer details, line items, shipping address, tracking numbers, and any refunds. For `format: json`, the raw order objects array.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| No orders returned | No match for lookup value | Verify lookup value format (order number must include `#`, e.g., `#1001`) |
| `lookup_by` invalid | Value is not `order_number`, `email`, or `phone` | Use one of the three accepted values |
| Rate limit (429) | Too many requests | Reduce `limit` or wait and retry |

## Best Practices
1. Order number lookups require the `#` prefix (e.g., `#1001`), which maps to the `name` field in the GraphQL query.
2. Phone lookups must use E.164 format (e.g., `+15551234567`); partial numbers will not match.
3. Email lookup returns all orders for that customer — set `limit` to retrieve more than the default 5 if the customer has many orders.
4. For `format: json`, pipe the output to `jq` to extract specific fields for downstream scripts.
5. This skill is read-only — use the `refund-and-reorder` skill if you need to process a refund after looking up the order.
