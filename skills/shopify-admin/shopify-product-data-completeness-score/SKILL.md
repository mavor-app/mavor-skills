---
name: shopify-product-data-completeness-score
displayName: Product Data Completeness Score
description: >-
  Read-only: scores each product on data completeness across description,
  images, SEO, weight, barcode, cost, and metafields.
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
  status_filter:
    type: string
    required: false
    description: 'Product status to score: `active`, `draft`, or `all`'
  required_metafields:
    type: string
    required: false
    description: >-
      List of `namespace.key` metafields that are required (e.g.,
      `["custom.material"]`)
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Calculates a data completeness score (0–100) for each active product based on the presence of key fields: description, images, SEO title, SEO description, variant weight, barcode, cost, and specified metafields. Produces a ranked list of products needing the most data work. Read-only — no mutations. Catalog health report in a single pass.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| status_filter | string | no | active | Product status to score: `active`, `draft`, or `all` |
| required_metafields | array | no | [] | List of `namespace.key` metafields that are required (e.g., `["custom.material"]`) |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Scoring Rubric

| Field | Points |
|-------|--------|
| Description present (non-empty) | 15 |
| At least 1 image | 15 |
| SEO title present | 10 |
| SEO description present | 10 |
| At least 1 variant with barcode | 10 |
| At least 1 variant with cost | 10 |
| At least 1 variant with weight | 10 |
| All required metafields present | 20 (split evenly) |
| **Total** | **100** |

## Workflow Steps

1. **OPERATION:** `products` — query
   **Inputs:** `query: "status:<status_filter>"`, `first: 250`, select all completeness fields, pagination cursor
   **Expected output:** Products with all scored fields; paginate until `hasNextPage: false`

2. Score each product per rubric; rank ascending by score

## GraphQL Operations

```graphql
# products:query — validated against api_version 2025-01
query ProductCompleteness($query: String!, $after: String) {
  products(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        title
        handle
        descriptionHtml
        images(first: 1) {
          edges {
            node {
              id
            }
          }
        }
        seo {
          title
          description
        }
        variants(first: 10) {
          edges {
            node {
              id
              barcode
              weight
              inventoryItem {
                unitCost {
                  amount
                }
              }
            }
          }
        }
        metafields(first: 20) {
          edges {
            node {
              namespace
              key
              value
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
CSV file `completeness_<YYYY-MM-DD>.csv` with columns:
`product_id`, `title`, `score`, `has_description`, `image_count`, `has_seo_title`, `has_seo_description`, `has_barcode`, `has_cost`, `has_weight`, `missing_metafields`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No products match filter | Empty catalog or wrong filter | Exit with 0 results |

## Best Practices
- Use this skill as a pre-launch gate — run before activating DRAFT products to ensure all required fields are filled.
- Tune `required_metafields` to your store's specific needs (e.g., `custom.material` for apparel, `custom.ingredients` for food).
- A score below 50 typically means a product is missing foundational content (description or images) and should be deprioritized from launch until fixed.
- Run monthly to track catalog quality trends over time; improvements after a content sprint should be visible in the average score.
