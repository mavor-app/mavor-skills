---
name: shopify-refund-and-reorder
displayName: Refund And Reorder
description: >-
  Process a full or partial refund on an order and optionally create a
  replacement draft order for the customer.
version: 1.0.0
category: customer-support
runtime:
  type: llm
  executor: auto
capabilities:
  tools:
    - shopify_graphql_query
  permissions:
    - shop.order.write
    - shop.price.update
    - shop.read
tags:
  - shopify
  - customer-support
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
  refund_line_items:
    type: string
    required: false
    description: >-
      Array of `{line_item_id, quantity}` to refund; if omitted, refunds all
      refundable quantities
  reason:
    type: string
    required: false
    description: 'Refund reason: `customer`, `fraud`, `inventory`, `declined`, `other`'
  create_replacement:
    type: boolean
    required: false
    description: 'If true, create a draft order with the same line items after refund'
  notify_customer:
    type: boolean
    required: false
    description: Send refund notification email to customer
---
## Purpose
Processes refunds and creates replacement orders without navigating the Shopify admin UI. This skill handles both the refund and the optional replacement draft order in a single workflow.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| format | string | no | human | Output format: `human` or `json` |
| dry_run | bool | no | false | Preview operations without executing mutations |
| order_id | string | yes | — | GID of the order (e.g., `gid://shopify/Order/12345`) |
| refund_line_items | array | no | all refundable | Array of `{line_item_id, quantity}` to refund; if omitted, refunds all refundable quantities |
| reason | string | no | other | Refund reason: `customer`, `fraud`, `inventory`, `declined`, `other` |
| create_replacement | bool | no | false | If true, create a draft order with the same line items after refund |
| notify_customer | bool | no | true | Send refund notification email to customer |

## Safety

> ⚠️ Steps 2 and 3 execute irreversible financial mutations. `refundCreate` cannot be undone — once a refund is processed, the payment cannot be re-captured. `draftOrderCreate` creates a new draft order that must be invoiced and paid separately. Run with `dry_run: true` to verify the refund line items and amounts before committing. Verify `refundableQuantity` per line item from Step 1 before proceeding.

## Workflow Steps

1. **OPERATION:** `order` — query
   **Inputs:** `id: <order_id>`
   **Expected output:** Full order with `displayFinancialStatus`, `lineItems` (with `refundableQuantity`), `transactions`, `customer`, `shippingAddress`; verify order is refundable before proceeding

2. **OPERATION:** `refundCreate` — mutation
   **Inputs:** `input.orderId`, `input.refundLineItems` (from parameter or all refundable), `input.notify`, `input.note: <reason>`
   **Expected output:** `refund.id`, `refund.totalRefundedSet`, `userErrors`

3. **OPERATION:** `draftOrderCreate` — mutation (only if `create_replacement: true`)
   **Inputs:** `input.lineItems` (from original order line items), `input.customerId`, `input.shippingAddress`, `input.note: "Replacement for order <name>"`
   **Expected output:** `draftOrder.id`, `draftOrder.name`, `draftOrder.invoiceUrl`, `userErrors`

## GraphQL Operations

```graphql
# order:query — validated against api_version 2025-01
query OrderForRefund($id: ID!) {
  order(id: $id) {
    id
    name
    displayFinancialStatus
    displayFulfillmentStatus
    totalPriceSet {
      shopMoney { amount currencyCode }
    }
    lineItems(first: 50) {
      edges {
        node {
          id
          title
          quantity
          refundableQuantity
          variant {
            id
            sku
            price
          }
        }
      }
    }
    transactions(first: 10) {
      id
      kind
      status
      amountSet {
        shopMoney { amount currencyCode }
      }
      gateway
    }
    refunds {
      id
      createdAt
      totalRefundedSet {
        shopMoney { amount currencyCode }
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
    shippingAddress {
      address1
      city
      province
      country
      zip
    }
  }
}
```

```graphql
# refundCreate:mutation — validated against api_version 2025-01
mutation RefundCreate($input: RefundInput!) {
  refundCreate(input: $input) {
    refund {
      id
      createdAt
      totalRefundedSet {
        shopMoney { amount currencyCode }
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

```graphql
# draftOrderCreate:mutation — validated against api_version 2025-01
mutation DraftOrderCreate($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder {
      id
      name
      invoiceUrl
    }
    userErrors {
      field
      message
    }
  }
}
```

## Output Format
No CSV output. The session completion summary reports the refund ID and amount. If `create_replacement: true`, the draft order name and invoice URL are included in the output.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `refundableQuantity` is 0 | Line item already fully refunded | Check order refund history |
| `userErrors` from refundCreate | Invalid refund amounts or order not refundable | Check `displayFinancialStatus` — must not be `REFUNDED` |
| `userErrors` from draftOrderCreate | Invalid line items or customer | Verify product variants still exist |
| Order not found | Invalid order GID | Use `order-lookup-and-summary` skill to find the correct order ID |

## Best Practices
1. Always run `dry_run: true` first — Step 2 is irreversible. Verify `refundableQuantity` per line item in Step 1 output before committing.
2. For partial refunds, specify `refund_line_items` explicitly — omitting it refunds all refundable items, which may not be intended.
3. The `create_replacement` draft order is not automatically invoiced or fulfilled — share `invoiceUrl` with the customer for payment.
4. Use `notify_customer: false` for internal corrections where the customer should not be alerted.
5. Check `displayFinancialStatus` from Step 1 — if it is `REFUNDED`, there is nothing left to refund.
