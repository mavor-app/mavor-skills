---
name: shopify-revenue-by-location-report
displayName: Revenue By Location Report
description: >-
  Read-only: breaks down revenue by fulfillment location for multi-warehouse P&L
  and location performance.
version: 1.0.0
category: finance
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
  - finance
input:
  days_back:
    type: number
    required: false
    description: Lookback window
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Attributes order revenue to the fulfillment location that shipped the order. Produces a revenue breakdown by warehouse or fulfillment center, useful for multi-location P&L, location staffing decisions, and understanding where demand is being fulfilled from. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| days_back | integer | no | 30 | Lookback window |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `locations` — query
   **Inputs:** `first: 50`, active only
   **Expected output:** Location IDs and names for enrichment

2. **OPERATION:** `orders` — query
   **Inputs:** `query: "fulfillment_status:shipped created_at:>='<NOW - days_back days>'"`, `first: 250`, select `fulfillments { assignedLocation }`, `totalPriceSet`, pagination cursor
   **Expected output:** Fulfilled orders with location attribution

3. **OPERATION:** `fulfillmentOrders` — query (for open orders attribution)
   **Inputs:** Per location, `status: CLOSED`, `first: 250`
   **Expected output:** Closed fulfillment orders for revenue attribution

4. Aggregate revenue by location; orders without location data attributed to "Unknown"

## GraphQL Operations

```graphql
# locations:query — validated against api_version 2025-01
query LocationsList {
  locations(first: 50, includeInactive: false) {
    edges {
      node {
        id
        name
      }
    }
  }
}
```

```graphql
# orders:query — validated against api_version 2025-01
query RevenueByLocation($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        fulfillments {
          assignedLocation {
            location {
              id
              name
            }
          }
          status
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
query ClosedFulfillmentOrders($locationId: ID!, $after: String) {
  fulfillmentOrders(
    assignedLocationId: $locationId
    first: 250
    after: $after
    query: "status:closed"
  ) {
    edges {
      node {
        id
        order {
          id
          name
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
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

## Output Format
CSV file `revenue_by_location_<YYYY-MM-DD>.csv` with columns:
`location_id`, `location_name`, `order_count`, `total_revenue`, `currency`, `share_pct`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Order with no fulfillment location | Unfulfilled or POS order | Attribute to "Unassigned" |
| Single-location store | All revenue from one location | Report still valid, shows full total |

## Best Practices
- For multi-3PL operations, this report helps identify if one 3PL is handling a disproportionate share and may need capacity relief.
- Revenue attribution here is based on fulfillment assignment, not customer shipping address — it reflects operational throughput per location, not geographic demand.
- Pair with the inventory valuation report to calculate inventory turns per location (revenue / inventory value).
