---
name: shopify-cancel-and-restock
displayName: Cancel And Restock
description: >-
  Cancel an unfulfilled order, optionally restock inventory, and optionally
  notify the customer — all in a single validated workflow.
version: 1.0.0
category: fulfillment-ops
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
  - fulfillment-ops
  - mutation
input:
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
  dry_run:
    type: boolean
    required: false
    description: Preview operations without executing mutations
  order_id:
    type: string
    required: true
    description: 'GID of the order (e.g., `gid://shopify/Order/12345`)'
  reason:
    type: string
    required: false
    description: >-
      Cancel reason: `CUSTOMER`, `DECLINED`, `FRAUD`, `INVENTORY`, `STAFF`,
      `OTHER`
  restock:
    type: boolean
    required: false
    description: Restock inventory for cancelled line items
  refund:
    type: boolean
    required: false
    description: Issue refund for any captured payments
  notify_customer:
    type: boolean
    required: false
    description: Send cancellation email to customer
  staff_note:
    type: string
    required: false
    description: Internal note recorded on the cancellation
---
## Purpose
Cancels an unfulfilled or partially-unfulfilled order with configurable restock, refund, and customer notification options — without navigating the Shopify admin. Useful for fraud exception handling, out-of-stock cancellations, or customer-requested cancellations before dispatch. Cannot cancel orders that are already fully fulfilled.

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
| order_id | string | yes | — | GID of the order (e.g., `gid://shopify/Order/12345`) |
| reason | string | no | `OTHER` | Cancel reason: `CUSTOMER`, `DECLINED`, `FRAUD`, `INVENTORY`, `STAFF`, `OTHER` |
| restock | bool | no | true | Restock inventory for cancelled line items |
| refund | bool | no | true | Issue refund for any captured payments |
| notify_customer | bool | no | true | Send cancellation email to customer |
| staff_note | string | no | — | Internal note recorded on the cancellation |

## Safety

> ⚠️ Steps 2 executes `orderCancel` which is irreversible. A cancelled order cannot be reopened. If `refund: true`, any captured payment is automatically refunded. If `restock: true`, inventory quantities are immediately restored. Run with `dry_run: true` to verify the order state and confirm it is cancellable before committing.

## Workflow Steps

1. **OPERATION:** `order` — query
   **Inputs:** `id: <order_id>`
   **Expected output:** Order `name`, `displayFulfillmentStatus`, `displayFinancialStatus`, `cancelledAt` (must be null), `fulfillmentOrders.status` (must be `OPEN` or `ON_HOLD` — abort if any fulfillment order is `IN_PROGRESS` or `CLOSED`)

2. **OPERATION:** `orderCancel` — mutation
   **Inputs:** `orderId`, `reason`, `restock`, `refund`, `notifyCustomer`, `staffNote`
   **Expected output:** `orderCancelUserErrors` — empty on success; order is now cancelled with `cancelledAt` timestamp

## GraphQL Operations

```graphql
# order:query — validated against api_version 2025-01
query OrderForCancel($id: ID!) {
  order(id: $id) {
    id
    name
    displayFulfillmentStatus
    displayFinancialStatus
    cancelledAt
    totalPriceSet {
      shopMoney { amount currencyCode }
    }
    lineItems(first: 50) {
      edges {
        node {
          id
          title
          quantity
          variant {
            id
            sku
            inventoryQuantity
          }
        }
      }
    }
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
      defaultEmailAddress {
        emailAddress
      }
      firstName
      lastName
    }
  }
}
```

```graphql
# orderCancel:mutation — validated against api_version 2025-01
mutation OrderCancel(
  $orderId: ID!
  $reason: OrderCancelReason!
  $restock: Boolean!
  $refund: Boolean!
  $notifyCustomer: Boolean!
  $staffNote: String
) {
  orderCancel(
    orderId: $orderId
    reason: $reason
    restock: $restock
    refund: $refund
    notifyCustomer: $notifyCustomer
    staffNote: $staffNote
  ) {
    orderCancelUserErrors {
      field
      message
    }
    userErrors {
      field
      message
    }
  }
}
```

## Output Format
No CSV output. The session summary reports the cancellation result inline. If `restock: true`, list the variant SKUs and quantities restored.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `cancelledAt` is not null | Order is already cancelled | No action needed |
| Fulfillment order `status: IN_PROGRESS` | Order is being picked/packed | Contact warehouse to stop — cannot cancel programmatically once IN_PROGRESS |
| `orderCancelUserErrors` | Order has already been fully fulfilled | Use `refund-and-reorder` skill instead |
| Order not found | Invalid order GID | Use `order-lookup-and-summary` skill to find the correct ID |

## Best Practices
1. Always run `dry_run: true` first — check `displayFulfillmentStatus` and fulfillment order statuses before committing to a cancel.
2. Set `reason: FRAUD` for high-risk orders — this reason is logged in Shopify's fraud analytics.
3. If the order has already been captured (status `PAID`), set `refund: true` — an uncredited cancellation will cause customer disputes.
4. For large cancellation batches (e.g., out-of-stock event), loop through order IDs using `format: json` to capture each result for audit logging.
5. If the warehouse has already started picking, do not cancel via API — contact them directly and cancel only after they confirm no physical work has started.
