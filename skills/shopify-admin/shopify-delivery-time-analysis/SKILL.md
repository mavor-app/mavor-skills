---
name: shopify-delivery-time-analysis
displayName: Delivery Time Analysis
description: >-
  Read-only: calculates average time from fulfillment creation to delivery by
  carrier using fulfillment and order data.
version: 1.0.0
category: fulfillment-ops
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
  - fulfillment-ops
input:
  days_back:
    type: number
    required: false
    description: Lookback window for fulfilled orders
  min_orders:
    type: number
    required: false
    description: Minimum orders per carrier to include in averages
  location_id:
    type: string
    required: false
    description: Filter by fulfillment location (optional)
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Analyzes fulfilled orders to calculate average transit time (fulfillment created → delivered) broken down by carrier. Surfaces which carriers are consistently slow or missing delivery confirmations. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| days_back | integer | no | 30 | Lookback window for fulfilled orders |
| min_orders | integer | no | 5 | Minimum orders per carrier to include in averages |
| location_id | string | no | — | Filter by fulfillment location (optional) |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "fulfillment_status:shipped created_at:>='<NOW - days_back days>'"`, `first: 250`, pagination cursor
   **Expected output:** Orders with `fulfillments { createdAt, updatedAt, deliveredAt, trackingInfo { company } }`; paginate until `hasNextPage: false`

2. Calculate transit times per carrier: `deliveredAt - createdAt` (skip orders where `deliveredAt` is null)

3. **OPERATION:** `fulfillmentOrders` — query (optional, for location breakdown)
   **Inputs:** `assignedLocationId: <location_id>`, `status: CLOSED`, `first: 250`
   **Expected output:** Fulfilled orders per location for location-level segmentation

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query FulfilledOrders($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        fulfillments {
          id
          createdAt
          updatedAt
          deliveredAt
          status
          trackingInfo {
            company
            number
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
# fulfillmentOrders:query — validated against api_version 2025-01
query FulfillmentOrdersByLocation($locationId: ID!, $after: String) {
  fulfillmentOrders(
    assignedLocationId: $locationId
    first: 250
    after: $after
    query: "status:closed"
  ) {
    edges {
      node {
        id
        assignedLocation {
          location {
            id
            name
          }
        }
        order {
          id
          name
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
CSV file `delivery_analysis_<YYYY-MM-DD>.csv` with columns:
`order_name`, `fulfillment_id`, `carrier`, `fulfilled_at`, `delivered_at`, `transit_days`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `deliveredAt` is null | Carrier hasn't confirmed delivery | Exclude from averages, count as "in transit" |
| No fulfilled orders in window | Period too short or no orders | Exit with summary: 0 orders |

## Best Practices
- Set `min_orders: 10` for statistically meaningful averages — carriers with fewer orders will skew results.
- `deliveredAt` is populated only when the carrier confirms delivery via tracking events; some carriers do not report this, so null values are expected.
- Run monthly to track carrier performance over time and inform carrier contract negotiations.
- Cross-reference with the `wismo-bulk-status-report` skill to correlate slow delivery carriers with WISMO ticket volume.
