---
name: shopify-frequently-bought-together
displayName: Frequently Bought Together
description: >-
  Read-only: mines order history to find product pairs and triplets frequently
  purchased together, generating cross-sell and bundle recommendations.
version: 1.0.0
category: conversion-optimization
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
  - conversion-optimization
input:
  days_back:
    type: number
    required: false
    description: Order lookback window
  min_support:
    type: number
    required: false
    description: Minimum co-occurrence count to report a pair
  max_results:
    type: number
    required: false
    description: Maximum product pairs to return
  group_size:
    type: number
    required: false
    description: 'Pair size: `2` for pairs, `3` for triplets'
  collection_filter:
    type: string
    required: false
    description: Limit to products in a specific collection
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Analyzes order history to discover which products are frequently purchased together. Calculates co-occurrence frequency, lift scores, and confidence metrics to generate data-driven cross-sell recommendations and bundle candidates. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| days_back | integer | no | 180 | Order lookback window |
| min_support | integer | no | 3 | Minimum co-occurrence count to report a pair |
| max_results | integer | no | 25 | Maximum product pairs to return |
| group_size | integer | no | 2 | Pair size: `2` for pairs, `3` for triplets |
| collection_filter | string | no | — | Limit to products in a specific collection |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `lineItems { product { id, title } }`, pagination cursor
   **Expected output:** All orders with product-level line items

2. For each order with 2+ distinct products, generate all product pair combinations

3. Build co-occurrence matrix:
   - **Support** = number of orders containing both products
   - **Confidence(A→B)** = P(B|A) = support(A,B) / support(A)
   - **Lift** = confidence(A→B) / P(B) — lift > 1.0 means positive association

4. **OPERATION:** `products` — query (enrichment)
   **Inputs:** Product IDs from top pairs for titles, images, prices
   **Expected output:** Product details for display

5. Rank pairs by lift score (descending), filter by min_support

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query OrderLineItems($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        lineItems(first: 50) {
          edges {
            node {
              product { id title }
              quantity
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
# products:query — validated against api_version 2025-01
query ProductDetails($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Product {
      id
      title
      vendor
      productType
      priceRangeV2 {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }
      totalInventory
      status
    }
  }
}
```

## Output Format
CSV file `fbt_pairs_<YYYY-MM-DD>.csv` with columns:
`product_a_id`, `product_a_title`, `product_b_id`, `product_b_title`, `support`, `confidence_a_to_b`, `confidence_b_to_a`, `lift`, `combined_avg_price`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Single-item orders only | Store with no multi-item orders | Report empty — suggest longer lookback window |
| Too many products | Combinatorial explosion | Limit to top 500 products by order count |

## Best Practices
- Use `days_back: 180` or `365` for sufficient sample size.
- Pairs with lift > 2.0 are strong bundle candidates.
- Use results to create manual product bundles or configure upsell apps.
- Cross-reference with `top-product-performance` to ensure paired items are high-performing.
- Products with high confidence A→B but low confidence B→A suggest directional upsells (show B when A is in cart).
