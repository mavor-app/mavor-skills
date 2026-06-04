---
name: shopify-fulfillment-location-routing
displayName: Fulfillment Location Routing
description: >-
  Reassign fulfillment orders from one location to another for warehouse
  overflow or regional routing.
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
  source_location_id:
    type: string
    required: true
    description: GID of the location to move orders FROM
  destination_location_id:
    type: string
    required: true
    description: GID of the location to move orders TO
  order_filter:
    type: string
    required: false
    description: 'Optional order name filter (e.g., "#1001,#1002")'
  dry_run:
    type: boolean
    required: false
    description: Preview moves without executing mutations
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Queries open fulfillment orders assigned to a source location and moves them to a destination location. Used when a warehouse is at capacity, a location is closing, or regional routing rules change. Replaces manual reassignment in Shopify Admin — this skill handles bulk location transfers for any number of open orders in a single workflow.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| source_location_id | string | yes | — | GID of the location to move orders FROM |
| destination_location_id | string | yes | — | GID of the location to move orders TO |
| order_filter | string | no | — | Optional order name filter (e.g., "#1001,#1002") |
| dry_run | bool | no | true | Preview moves without executing mutations |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ⚠️ `fulfillmentOrderMove` reassigns fulfillment responsibility. This affects which warehouse picks and ships the order. Verify destination location has sufficient stock for all products before moving. Run with `dry_run: true` to confirm the order list and destination before committing.

## Workflow Steps

1. **OPERATION:** `fulfillmentOrders` — query
   **Inputs:** `assignedLocationId: <source_location_id>`, `status: OPEN`, `first: 250`, pagination cursor
   **Expected output:** List of open fulfillment orders; paginate until `hasNextPage: false`

2. **OPERATION:** `fulfillmentOrderMove` — mutation
   **Inputs:** `id: <fulfillment_order_id>`, `newLocationId: <destination_location_id>`
   **Expected output:** `movedFulfillmentOrder { id, assignedLocation { name } }`, `userErrors`

## GraphQL Operations

```graphql
# fulfillmentOrders:query — validated against api_version 2025-01
query FulfillmentOrdersByLocation($locationId: ID!, $after: String) {
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
        assignedLocation {
          location {
            id
            name
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
# fulfillmentOrderMove:mutation — validated against api_version 2025-01
mutation FulfillmentOrderMove($id: ID!, $newLocationId: ID!) {
  fulfillmentOrderMove(id: $id, newLocationId: $newLocationId) {
    movedFulfillmentOrder {
      id
      assignedLocation {
        location {
          id
          name
        }
      }
    }
    originalFulfillmentOrder {
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

## Output Format
CSV file `routing_log_<YYYY-MM-DD>.csv` with columns:
`order_name`, `fulfillment_order_id`, `source_location`, `destination_location`, `status`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `userErrors` on fulfillmentOrderMove | Order already fulfilled or location inactive | Log error, skip order, continue |
| Destination location not stocked | Insufficient inventory at destination | Log warning per SKU, continue move |
| No open orders at source | Source has no pending work | Exit with summary: 0 orders found |

## Best Practices
- Always run with `dry_run: true` first — moving a fulfillment order does not move inventory; verify destination stock levels separately using the `multi-location-inventory-audit` skill.
- Use `order_filter` to move specific high-priority orders first rather than the entire queue.
- For location closures, run this skill before the location is deactivated in Shopify Admin.
