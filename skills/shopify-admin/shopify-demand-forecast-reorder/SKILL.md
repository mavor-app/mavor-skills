---
name: shopify-demand-forecast-reorder
displayName: Demand Forecast Reorder
description: >-
  Read-only: forecasts demand per SKU using sales velocity and seasonality, then
  calculates reorder points and suggested purchase order quantities.
version: 1.0.0
category: merchandising
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
  - merchandising
input:
  days_back:
    type: number
    required: false
    description: Historical sales window for velocity calculation
  forecast_days:
    type: number
    required: false
    description: Days into the future to forecast demand
  lead_time_days:
    type: number
    required: false
    description: Default vendor lead time in days
  safety_stock_days:
    type: number
    required: false
    description: Extra days of safety stock buffer
  vendor_filter:
    type: string
    required: false
    description: Scope to specific vendor
  only_low_stock:
    type: boolean
    required: false
    description: Only show items projected to stock out within forecast window
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Forecasts future demand for each SKU based on historical sales velocity, trend analysis, and optional seasonality adjustments. Calculates reorder points (when to order) and suggested reorder quantities (how much to order) factoring in vendor lead times and safety stock. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain |
| days_back | integer | no | 90 | Historical sales window for velocity calculation |
| forecast_days | integer | no | 30 | Days into the future to forecast demand |
| lead_time_days | integer | no | 14 | Default vendor lead time in days |
| safety_stock_days | integer | no | 7 | Extra days of safety stock buffer |
| vendor_filter | string | no | — | Scope to specific vendor |
| only_low_stock | boolean | no | false | Only show items projected to stock out within forecast window |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `createdAt`, `lineItems { variant { id }, quantity }`, pagination cursor
   **Expected output:** All orders with line items for sales velocity calculation

2. Calculate per-variant sales velocity:
   - Daily sales rate = total units sold / days_back
   - Weekly trend: compare last 30 days vs prior 30 days for trend direction
   - Forecasted demand = daily_rate × forecast_days × trend_multiplier

3. **OPERATION:** `productVariants` — query
   **Inputs:** All variant IDs with sales history, `first: 250`, pagination cursor
   **Expected output:** Variant details (SKU, title, product title, vendor)

4. **OPERATION:** `inventoryLevels` — query
   **Inputs:** Inventory item IDs for stocked variants
   **Expected output:** Current available quantities per location

5. Calculate reorder metrics:
   - **Days of Stock** = current_inventory / daily_sales_rate
   - **Reorder Point** = (lead_time_days + safety_stock_days) × daily_sales_rate
   - **Reorder Quantity** = forecast_days × daily_sales_rate + safety_stock - current_inventory
   - **Stockout Date** = today + (current_inventory / daily_sales_rate) days
   - **Order-By Date** = stockout_date - lead_time_days

6. Sort by urgency: items closest to stockout first

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query SalesHistory($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        createdAt
        lineItems(first: 50) {
          edges {
            node {
              quantity
              variant { id }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

```graphql
# productVariants:query — validated against api_version 2025-01
query VariantInfo($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      sku
      title
      product { id title vendor }
      inventoryQuantity
      inventoryItem { id }
    }
  }
}
```

```graphql
# inventoryItems:query — validated against api_version 2025-01
query InventoryItemDetails($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on InventoryItem {
      id
      unitCost { amount currencyCode }
      tracked
      inventoryLevels(first: 10) {
        edges {
          node {
            quantities(names: ["available"]) {
              name
              quantity
            }
            location { id name }
          }
        }
      }
    }
  }
}
```

```graphql
# inventoryLevels:query — validated against api_version 2025-01
query LocationInventory($locationId: ID!, $after: String) {
  location(id: $locationId) {
    inventoryLevels(first: 250, after: $after) {
      edges {
        node {
          quantities(names: ["available"]) { name quantity }
          item { id variant { id sku product { title } } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
```

## Output Format
CSV file `reorder_plan_<YYYY-MM-DD>.csv` with columns:
`variant_id`, `sku`, `product_title`, `vendor`, `current_stock`, `daily_velocity`, `trend`, `days_of_stock`, `stockout_date`, `reorder_point`, `reorder_qty`, `order_by_date`, `est_cost`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Zero sales velocity | Product never sold in window | Skip from reorder calc — flag as "no demand data" |
| No inventory tracking | Variant not tracked | Skip — cannot forecast untracked items |

## Best Practices
- Set `lead_time_days` per vendor if possible; default 14 is conservative.
- Use `safety_stock_days: 14` for high-value or slow-ship items.
- Run weekly and pipe output into a purchase order workflow.
- Cross-reference with `stock-velocity-report` for velocity validation.
- Use with `dead-stock-identifier` to avoid reordering items that aren't selling.
- For seasonal products, use a longer `days_back` (180-365) to capture seasonal patterns.
