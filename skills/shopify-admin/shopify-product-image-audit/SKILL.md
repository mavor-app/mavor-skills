---
name: shopify-product-image-audit
displayName: Product Image Audit
description: >-
  Read-only: flags products and variants with missing images or fewer than a
  minimum number of images.
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
  min_images:
    type: number
    required: false
    description: Flag products with fewer than this many images
  check_variants:
    type: boolean
    required: false
    description: Also flag variants with no assigned image
  status_filter:
    type: string
    required: false
    description: 'Product status to scan: `active`, `draft`, or `all`'
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Scans all active products and their variants for missing or insufficient images. Flags products with zero images, variants with no assigned image, and products below a minimum image count threshold. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| min_images | integer | no | 1 | Flag products with fewer than this many images |
| check_variants | bool | no | true | Also flag variants with no assigned image |
| status_filter | string | no | active | Product status to scan: `active`, `draft`, or `all` |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `products` — query
   **Inputs:** `query: "status:<status_filter>"`, `first: 250`, select `images`, `variants { image }`, pagination cursor
   **Expected output:** Products with image counts and variant image assignments; paginate until `hasNextPage: false`

2. Flag products: `images.count < min_images` OR `images.count == 0`

3. If `check_variants`: flag variants where `image` is null

## GraphQL Operations

```graphql
# products:query — validated against api_version 2025-01
query ProductImageAudit($query: String!, $after: String) {
  products(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        title
        handle
        status
        images(first: 10) {
          edges {
            node {
              id
              url
              altText
            }
          }
        }
        variants(first: 50) {
          edges {
            node {
              id
              title
              sku
              image {
                id
                url
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
CSV file `image_audit_<YYYY-MM-DD>.csv` with columns:
`product_id`, `product_title`, `handle`, `image_count`, `issue`, `variant_id`, `variant_sku`, `variant_has_image`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No products match filter | Empty catalog or wrong status filter | Exit with 0 results |

## Best Practices
- Products with zero images cannot be sold on most sales channels (Google Shopping, Meta, etc.) — prioritize these as urgent.
- For apparel or products with color/size variants, set `min_images: 3` to ensure at least one front, back, and lifestyle shot per product.
- Run after bulk product imports to catch images that failed to upload in the import batch.
- Pair with `product-data-completeness-score` for a single comprehensive catalog quality report.
