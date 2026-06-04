---
name: shopify-bulk-fulfillment-creation
displayName: Bulk Fulfillment Creation
description: >-
  Batch-fulfill open fulfillment orders with tracking numbers. Supports partial
  fulfillment and customer notification toggle.
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
  location_id:
    type: string
    required: true
    description: 'GID of the fulfillment location (e.g., gid://shopify/Location/123)'
  tracking_numbers:
    type: string
    required: false
    description: >-
      List of `{fulfillment_order_id, tracking_number, tracking_url, carrier}`
      objects
  notify_customer:
    type: boolean
    required: false
    description: Send shipping confirmation email to customer
  dry_run:
    type: boolean
    required: false
    description: Preview fulfillments without executing mutations
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Queries all open fulfillment orders for a location and batch-creates fulfillments with tracking numbers in a single workflow. No third-party app required — this skill handles the fulfillment creation layer; carrier label generation requires a separate tool or carrier integration.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| location_id | string | yes | — | GID of the fulfillment location (e.g., gid://shopify/Location/123) |
| tracking_numbers | array | no | [] | List of `{fulfillment_order_id, tracking_number, tracking_url, carrier}` objects |
| notify_customer | bool | no | true | Send shipping confirmation email to customer |
| dry_run | bool | no | true | Preview fulfillments without executing mutations |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ⚠️ `fulfillmentCreate` is irreversible — fulfilled orders cannot be unfulfilled via the API. Run with `dry_run: true` first to confirm the list of fulfillment orders before committing. Each mutation creates one fulfillment record per fulfillment order.

## Workflow Steps

1. **OPERATION:** `fulfillmentOrders` — query
   **Inputs:** `assignedLocationId: <location_id>`, `status: OPEN`, `first: 250`, pagination cursor
   **Expected output:** List of open fulfillment orders with `id`, `order { name }`, `lineItems`; paginate until `hasNextPage: false`

2. **OPERATION:** `fulfillmentCreate` — mutation
   **Inputs:** For each fulfillment order: `fulfillmentOrderId`, `trackingInfo { company, number, url }`, `notifyCustomer`
   **Expected output:** `fulfillment { id, status, trackingInfo }`, `userErrors`

## GraphQL Operations

```graphql
# fulfillmentOrders:query — validated against api_version 2025-01
query OpenFulfillmentOrders($locationId: ID!, $after: String) {
  fulfillmentOrders(
    assignedLocationId: $locationId
    first: 250
    after: $after
    query: "status:open"
  ) {
    edges {
      node {
        id
        status
        order {
          id
          name
        }
        lineItems(first: 10) {
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
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

```graphql
# fulfillmentCreate:mutation — validated against api_version 2025-01
mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) {
    fulfillment {
      id
      status
      trackingInfo {
        company
        number
        url
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
CSV file `fulfillment_batch_<YYYY-MM-DD>.csv` with columns:
`order_name`, `fulfillment_order_id`, `fulfillment_id`, `tracking_number`, `carrier`, `notify_customer`, `status`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `userErrors` on fulfillmentCreate | Already fulfilled or invalid tracking | Log error, skip order, continue |
| `FULFILLMENT_ORDER_LINE_ITEM_QUANTITY_MISMATCH` | Partial fulfillment quantity mismatch | Log warning, attempt partial fulfillment |
| No open orders at location | Location has no pending work | Exit with summary: 0 orders found |

## Best Practices
- Always run with `dry_run: true` first — fulfillments cannot be undone via the Admin API.
- Pass `notify_customer: false` during batch testing or for B2B orders where customers do not expect individual shipment emails.
- Provide tracking numbers in the `tracking_numbers` parameter before running; unfulfilled orders without tracking will still create fulfillments — confirm this is intentional.
- For large batches (100+ orders), the mutation loop will hit rate limits — the skill retries automatically with a 2-second back-off.
