---
name: shopify-order-hold-and-release
displayName: Order Hold And Release
description: >-
  Place or release fulfillment holds on open orders in batch — with a stated
  reason and optional expiry date.
version: 1.0.0
category: fulfillment-ops
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
  - fulfillment-ops
  - mutation
input:
  action:
    type: string
    required: true
    description: '`hold` or `release`'
  order_ids:
    type: string
    required: false
    description: 'Array of order GIDs to target (e.g., `["gid://shopify/Order/123"]`)'
  query_filter:
    type: string
    required: false
    description: 'Shopify order search query to select orders (e.g., `"tag:fraud-review"`)'
  reason:
    type: string
    required: false
    description: >-
      Hold reason: `AWAITING_PAYMENT`, `HIGH_RISK_OF_FRAUD`,
      `INCORRECT_ADDRESS`, `INVENTORY_OUT_OF_STOCK`, `OTHER`
  reason_notes:
    type: string
    required: false
    description: Free-text note visible to fulfillment staff
  hold_until:
    type: string
    required: false
    description: ISO 8601 date when hold auto-expires (optional)
---
## Purpose
Places or releases holds on fulfillment orders programmatically without navigating the Shopify admin. Useful for fraud review queues, inventory shortages, or payment verification workflows. Works on orders with fulfillment orders in `OPEN` status.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters
User inputs (YAML `input` in frontmatter; workspace connectionId is injected — do not ask for store domain):

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| action | string | yes | — | `hold` or `release` |
| order_ids | array | no* | — | Array of order GIDs to target (e.g., `["gid://shopify/Order/123"]`) |
| query_filter | string | no* | — | Shopify order search query to select orders (e.g., `"tag:fraud-review"`) |
| reason | string | no | `OTHER` | Hold reason: `AWAITING_PAYMENT`, `HIGH_RISK_OF_FRAUD`, `INCORRECT_ADDRESS`, `INVENTORY_OUT_OF_STOCK`, `OTHER` |
| reason_notes | string | no | — | Free-text note visible to fulfillment staff |
| hold_until | string | no | — | ISO 8601 date when hold auto-expires (optional) |

*One of `order_ids` or `query_filter` is required.

## Safety

> ⚠️ Step 2 places or releases holds on live fulfillment orders. Holding an order prevents it from being fulfilled and may delay delivery. Releasing a hold allows fulfillment to proceed immediately. Run with `dry_run: true` to preview which orders will be affected before committing.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `order_ids` list or `query_filter` string; fetch each order's `fulfillmentOrders` to get the fulfillment order IDs and current `status`
   **Expected output:** List of fulfillment order GIDs with their current `status`; skip any already in the target state (already held / not held)

2. **OPERATION:** `fulfillmentOrderHold` — mutation (if `action: hold`)
   **Inputs:** `id: <fulfillmentOrderId>`, `fulfillmentHold: { reason, reasonNotes, holdUntilDate }` per fulfillment order
   **Expected output:** Updated `fulfillmentOrder.status: ON_HOLD`, `userErrors`

   **OR**

2. **OPERATION:** `fulfillmentOrderReleaseHold` — mutation (if `action: release`)
   **Inputs:** `id: <fulfillmentOrderId>` per held fulfillment order
   **Expected output:** Updated `fulfillmentOrder.status: OPEN`, `userErrors`

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query OrdersForHold($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        name
        displayFulfillmentStatus
        fulfillmentOrders(first: 5) {
          edges {
            node {
              id
              status
              requestStatus
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
# fulfillmentOrderHold:mutation — validated against api_version 2025-01
mutation FulfillmentOrderHold($id: ID!, $fulfillmentHold: FulfillmentOrderHoldInput!) {
  fulfillmentOrderHold(id: $id, fulfillmentHold: $fulfillmentHold) {
    fulfillmentOrder {
      id
      status
    }
    remainingFulfillmentOrder {
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

```graphql
# fulfillmentOrderReleaseHold:mutation — validated against api_version 2025-01
mutation FulfillmentOrderReleaseHold($id: ID!) {
  fulfillmentOrderReleaseHold(id: $id) {
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
No CSV. Inline summary table:
| Order | Fulfillment Order ID | Previous Status | New Status |
|-------|---------------------|-----------------|------------|
| #1001 | gid://...FulfillmentOrder/456 | OPEN | ON_HOLD |

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `fulfillmentOrder.status` is already `ON_HOLD` | Order already held | Skipped automatically — logged in output |
| `fulfillmentOrder.status` is not `OPEN` or `ON_HOLD` | Order is already fulfilled, cancelled, or in progress | Cannot hold/release; skip and report |
| `INVENTORY_OUT_OF_STOCK` reason without note | Some stores require a note for this reason | Add `reason_notes` parameter |
| `userErrors` from mutation | Insufficient scopes or invalid fulfillment order state | Verify `write_merchant_managed_fulfillment_orders` scope |

## Best Practices
1. Use `query_filter: "tag:fraud-review"` to hold all orders tagged by your fraud detection process in one command.
2. Set `hold_until` to automatically release holds after a review window — prevents holds being forgotten on customer orders.
3. Always run `dry_run: true` first when using `query_filter` — confirm the order count before holding dozens of orders at once.
4. Combine with `fulfillment-status-digest` to identify held orders and then batch-release them after resolving exceptions.
5. The `AWAITING_PAYMENT` reason is visible to fulfillment staff and provides context for why an order is paused.
