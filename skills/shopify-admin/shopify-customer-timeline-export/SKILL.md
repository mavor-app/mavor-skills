---
name: shopify-customer-timeline-export
displayName: Customer Timeline Export
description: >-
  Read-only: exports a complete chronological history for a single customer —
  orders, refunds, returns, addresses, notes, tags, marketing consent, and
  lifetime spend — as one consolidated CSV.
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
  customer_id:
    type: string
    required: true
    description: 'GID of the customer (e.g., `gid://shopify/Customer/12345`)'
  include_line_items:
    type: boolean
    required: false
    description: Include per-line-item rows in the CSV (one row per line item)
  include_refunds:
    type: boolean
    required: false
    description: Include refunds and returns as separate rows in the timeline
  max_orders:
    type: number
    required: false
    description: Cap on orders fetched (most recent first); 0 = no cap
---
## Purpose
Produces a complete, chronological dossier for a single customer. Pulls the customer record (identity, marketing consent, lifetime totals, tags, notes, addresses) and every order they've placed (with line items, fulfillments, refunds, and returns) and emits one merged CSV plus a human-readable timeline. Used by support agents handling escalations, by data export requests, and as the source-of-truth dump before an account merge or deletion. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| format | string | no | human | Output format: `human` or `json` |
| customer_id | string | yes | — | GID of the customer (e.g., `gid://shopify/Customer/12345`) |
| include_line_items | bool | no | true | Include per-line-item rows in the CSV (one row per line item) |
| include_refunds | bool | no | true | Include refunds and returns as separate rows in the timeline |
| max_orders | integer | no | 250 | Cap on orders fetched (most recent first); 0 = no cap |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time. Output contains personally identifiable information — handle the resulting CSV with the same care as any customer export and delete it once the support case is closed.

## Workflow Steps

1. **OPERATION:** `customer` — query
   **Inputs:** `id: <customer_id>`, select identity fields, lifetime aggregates, tags, note, marketing consent, addresses, createdAt
   **Expected output:** Customer header record; abort with a clear error if `null`

2. **OPERATION:** `orders` — query
   **Inputs:** `query: "customer_id:<numeric_id>"`, `first: 250`, `sortKey: CREATED_AT`, `reverse: true`, select `id`, `name`, `createdAt`, `processedAt`, `displayFinancialStatus`, `displayFulfillmentStatus`, `totalPriceSet`, `totalShippingPriceSet`, `totalDiscountsSet`, `lineItems(first: 50) { node { id title quantity sku discountedTotalSet variant { sku } } }`, `fulfillments { id status deliveredAt trackingInfo { number url } }`, `refunds { id createdAt totalRefundedSet refundLineItems(first: 50) { node { lineItem { id title } quantity subtotalSet } } }`, pagination cursor (stop at `max_orders` if set)
   **Expected output:** Full chronological order list with embedded refunds and fulfillments

3. Build the merged timeline events: customer creation → each order → each refund/return per order. Sort all events by datetime ascending for the human-readable summary; the CSV is also sorted ascending.

## GraphQL Operations

```graphql
# customer:query — validated against api_version 2025-01
query CustomerHeaderForTimeline($id: ID!) {
  customer(id: $id) {
    id
    displayName
    firstName
    lastName
    defaultEmailAddress { emailAddress }
    phone
    note
    tags
    numberOfOrders
    amountSpent { amount currencyCode }
    emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt }
    smsMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt }
    addresses(first: 25) {
      id firstName lastName address1 address2 city provinceCode countryCodeV2 zip phone
    }
    defaultAddress { id }
    createdAt
    updatedAt
  }
}
```

```graphql
# orders:query — validated against api_version 2025-01
query CustomerOrdersForTimeline($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    edges {
      node {
        id
        name
        createdAt
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        cancelledAt
        cancelReason
        totalPriceSet { shopMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        lineItems(first: 50) {
          edges { node {
            id title quantity sku
            discountedTotalSet { shopMoney { amount currencyCode } }
            variant { id sku }
          } }
        }
        fulfillments {
          id status deliveredAt
          trackingInfo { number url company }
        }
        refunds {
          id
          createdAt
          totalRefundedSet { shopMoney { amount currencyCode } }
          refundLineItems(first: 50) {
            edges { node {
              quantity
              lineItem { id title }
              subtotalSet { shopMoney { amount currencyCode } }
            } }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

## Output Format
CSV file `customer_timeline_<customer_id>_<YYYY-MM-DD>.csv` with columns:
`event_datetime`, `event_type`, `event_id`, `order_name`, `line_item_title`, `sku`, `quantity`, `amount`, `currency`, `financial_status`, `fulfillment_status`, `tracking_number`, `notes`

Event types include: `customer_created`, `order_placed`, `order_fulfilled`, `order_delivered`, `order_cancelled`, `refund_issued`, `return_initiated`.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Customer not found | Wrong GID | Use `order-lookup-and-summary` to find a recent order, then read `customer.id` |
| 0 orders | New account or guest-only | Emit header-only timeline |
| Order anonymized | GDPR data wipe | Skip line items; emit placeholder row |
| Pagination beyond `max_orders` | Cap reached | Stop, set `truncated: true` |

## Best Practices
- Run before any merge, deletion, or escalation — pre-state is unreconstructable once a merge commits.
- For high-volume customers set `max_orders: 50`; full lifetime is rarely needed for one support case.
- CSV is event-sorted so downstream pivoting works without reshaping.
- Pair with `customer-merge`: run on both winner and loser before merging for a permanent pre-merge record.
