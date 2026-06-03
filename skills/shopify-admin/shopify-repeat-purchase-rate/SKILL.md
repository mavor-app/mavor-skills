---
name: shopify-repeat-purchase-rate
displayName: Repeat Purchase Rate
description: >-
  Read-only: calculates what percentage of customers place 2+ orders within N
  days, segmented by product or collection.
version: 1.0.0
category: order-intelligence
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
  - order-intelligence
input:
  days_back:
    type: number
    required: false
    description: Acquisition window — customers first purchased in this period
  repeat_window:
    type: number
    required: false
    description: Days after first purchase to look for a repeat order
  segment_by:
    type: string
    required: false
    description: 'Segment repeat rate by: `product`, `none`'
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Calculates the repeat purchase rate — the percentage of customers who return to place at least one more order within a defined window — and segments it by first-purchase product or collection. Identifies which products drive the highest repeat purchase behavior. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| days_back | integer | no | 90 | Acquisition window — customers first purchased in this period |
| repeat_window | integer | no | 90 | Days after first purchase to look for a repeat order |
| segment_by | string | no | none | Segment repeat rate by: `product`, `none` |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `customers` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `id`, `numberOfOrders`, `createdAt`
   **Expected output:** Customers acquired in window

2. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back + repeat_window days>'"`, `first: 250`, select `customer { id }`, `createdAt`, `lineItems { product { id, title } }`, pagination cursor
   **Expected output:** Orders to build per-customer purchase history and first-product mapping

3. For each acquired customer: if they have ≥ 2 orders within `repeat_window` days → repeat purchaser

4. Calculate overall rate; if `segment_by: product`, group by first-purchased product

## GraphQL Operations

```graphql
# customers:query — validated against api_version 2025-01
query AcquiredCustomers($query: String!, $after: String) {
  customers(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        createdAt
        numberOfOrders
        defaultEmailAddress {
          emailAddress
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
# orders:query — validated against api_version 2025-01
query CustomerOrderHistory($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        createdAt
        customer {
          id
        }
        lineItems(first: 5) {
          edges {
            node {
              product {
                id
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

## Output Format
CSV file `repeat_purchase_<YYYY-MM-DD>.csv` with columns:
`customer_id`, `first_order_date`, `first_product`, `total_orders`, `is_repeat`, `days_to_repeat`, `total_spent`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Guest checkout customers | No customer record to link orders | Exclude from analysis |
| Insufficient history | Store newer than window | Analyze available period |

## Best Practices
- A repeat rate of 25–35% within 90 days is a healthy baseline for most non-subscription ecommerce stores.
- Products with high repeat rates are your "gateway" products — prioritize them in acquisition campaigns.
- Use `segment_by: product` to identify which products create loyal customers vs. one-time buyers.
- Pair with `customer-cohort-analysis` for a deeper view of long-term retention trends.
