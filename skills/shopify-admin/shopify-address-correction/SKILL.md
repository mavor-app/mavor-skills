---
name: shopify-address-correction
displayName: Address Correction
description: Update the shipping address on an unfulfilled order before it ships.
version: 1.0.0
category: customer-support
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
  new_address:
    type: string
    required: true
    description: >-
      New shipping address: `address1`, `address2` (optional), `city`,
      `province`, `country`, `zip`, `phone` (optional), `first_name`,
      `last_name`
---
## Purpose
Corrects a shipping address on an unfulfilled order without navigating the Shopify admin UI. This skill is useful when a customer provides a correction after placing the order — for example, a typo in the street address or a wrong ZIP code. It replaces the manual address editing flow in the Shopify admin by executing the address update directly via the Admin API. The update must be performed before the order is fulfilled; this skill will abort with an error if the order has already been fulfilled or is partially fulfilled. Once fulfillment begins, the Shopify order record cannot be updated through this skill.

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
| new_address | object | yes | — | New shipping address: `address1`, `address2` (optional), `city`, `province`, `country`, `zip`, `phone` (optional), `first_name`, `last_name` |

## Safety

> ⚠️ Step 2 executes `orderUpdate` which immediately changes the shipping address on record. If the order is already with a fulfillment partner, notify them separately — this skill updates the Shopify record only. This skill will abort with an error if `displayFulfillmentStatus` is not `UNFULFILLED`. Address changes cannot be applied to partially or fully fulfilled orders.

## Workflow Steps

1. **OPERATION:** `order` — query
   **Inputs:** `id: <order_id>`
   **Expected output:** Order name, `displayFulfillmentStatus`, current `shippingAddress`; if `displayFulfillmentStatus != "UNFULFILLED"`, abort with message: "Cannot update address: order has already been fulfilled."

2. **OPERATION:** `orderUpdate` — mutation
   **Inputs:** `input.id: <order_id>`, `input.shippingAddress: <new_address object>`
   **Expected output:** Updated `shippingAddress` on the order, `userErrors`

## GraphQL Operations

```graphql
# order:query — validated against api_version 2025-01
query OrderForAddressCheck($id: ID!) {
  order(id: $id) {
    id
    name
    displayFulfillmentStatus
    shippingAddress {
      address1
      address2
      city
      province
      country
      zip
      phone
      firstName
      lastName
    }
  }
}
```

```graphql
# orderUpdate:mutation — validated against api_version 2025-01
mutation OrderUpdate($input: OrderInput!) {
  orderUpdate(input: $input) {
    order {
      id
      shippingAddress {
        address1
        address2
        city
        province
        country
        zip
        phone
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

## Output Format
No CSV output. The skill reports the updated address in the session completion summary. The new address is shown in the `[2/2]` step output.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `displayFulfillmentStatus != UNFULFILLED` | Order is already fulfilled or partially fulfilled | Cannot update address; contact the carrier directly |
| `userErrors` from orderUpdate | Invalid address fields (e.g., invalid country code) | Verify ISO country code and province/state format |
| Order not found | Invalid order GID | Use `order-lookup-and-summary` skill to find the correct order ID |

## Best Practices
1. Always run `dry_run: true` first — Step 1 shows the current address for confirmation before Step 2 commits the change.
2. Country must be the ISO 3166-1 alpha-2 code (e.g., `US`, `CA`, `GB`) — not the full country name.
3. This skill only updates the Shopify order record. If you use a third-party fulfillment provider, also update the address in their system.
4. For phone field, use E.164 format (e.g., `+15551234567`).
5. After updating, use the `order-lookup-and-summary` skill to confirm the address change took effect.
