---
name: shopify-split-shipment-planner
displayName: Split Shipment Planner
description: >-
  Splits a multi-line fulfillment order into separate shipments for partial or
  location-specific shipping.
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
  fulfillment_order_id:
    type: string
    required: true
    description: GID of the fulfillment order to split
  split_groups:
    type: string
    required: true
    description: 'List of `{line_item_ids: [], quantities: []}` defining each shipment group'
  dry_run:
    type: boolean
    required: false
    description: Preview split without executing mutation
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Splits a fulfillment order containing multiple line items into two or more separate fulfillment orders, each of which can be shipped independently with its own tracking number. Used when items in an order ship from different locations, on different dates, or require different carriers. Replaces manual split-shipment handling in Shopify Admin.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| fulfillment_order_id | string | yes | — | GID of the fulfillment order to split |
| split_groups | array | yes | — | List of `{line_item_ids: [], quantities: []}` defining each shipment group |
| dry_run | bool | no | true | Preview split without executing mutation |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ⚠️ `fulfillmentOrderSplit` is irreversible — a split fulfillment order cannot be merged back. The original fulfillment order is replaced by multiple new ones. Run with `dry_run: true` to confirm the intended groupings before committing. Ensure all `line_item_ids` in `split_groups` belong to the target fulfillment order.

## Workflow Steps

1. **OPERATION:** `fulfillmentOrders` — query
   **Inputs:** Query for the specific fulfillment order by order ID, filter by `status: OPEN`
   **Expected output:** Fulfillment order with all `lineItems { id, remainingQuantity, variant { sku, title } }`

2. Validate `split_groups` — confirm all line item IDs exist in the fulfillment order and quantities are ≤ remaining quantities

3. **OPERATION:** `fulfillmentOrderSplit` — mutation
   **Inputs:** `fulfillmentOrderId`, `fulfillmentOrderLineItems` array per split group
   **Expected output:** Array of new `fulfillmentOrders { id, lineItems }`, `userErrors`

## GraphQL Operations

```graphql
# fulfillmentOrders:query — validated against api_version 2025-01
query FulfillmentOrderLines($orderId: ID!) {
  order(id: $orderId) {
    id
    name
    fulfillmentOrders(first: 10) {
      edges {
        node {
          id
          status
          lineItems(first: 50) {
            edges {
              node {
                id
                remainingQuantity
                totalQuantity
                variant {
                  id
                  sku
                  title
                }
              }
            }
          }
        }
      }
    }
  }
}
```

```graphql
# fulfillmentOrderSplit:mutation — validated against api_version 2025-01
mutation FulfillmentOrderSplit($fulfillmentOrderId: ID!, $fulfillmentOrderLineItems: [FulfillmentOrderLineItemInput!]!) {
  fulfillmentOrderSplit(
    fulfillmentOrderId: $fulfillmentOrderId
    fulfillmentOrderLineItems: $fulfillmentOrderLineItems
  ) {
    fulfillmentOrders {
      id
      status
      lineItems(first: 50) {
        edges {
          node {
            id
            remainingQuantity
            variant {
              sku
              title
            }
          }
        }
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
Human-readable split summary. No CSV output — split results are viewable in Shopify Admin under the order's fulfillment tab.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry |
| `userErrors` — invalid line item | Line item ID not in fulfillment order | Abort and report mismatch |
| `userErrors` — quantity exceeds remaining | Split quantity > remaining quantity | Abort and report per line item |
| Fulfillment order not OPEN | Already fulfilled or cancelled | Abort with status report |

## Best Practices
- Use `dry_run: true` to preview the resulting shipment groups before splitting — a split cannot be reversed.
- Ensure `split_groups` covers all line items in the fulfillment order; any unassigned items will remain in the original (residual) fulfillment order.
- For orders with items shipping from different warehouses, use the `fulfillment-location-routing` skill to move the split groups to the correct locations after splitting.
