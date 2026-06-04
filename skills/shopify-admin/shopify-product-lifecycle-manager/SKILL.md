---
name: shopify-product-lifecycle-manager
displayName: Product Lifecycle Manager
description: >-
  Bulk transition products through DRAFT → ACTIVE → ARCHIVED status for seasonal
  launches and sunsetting.
version: 1.0.0
category: merchandising
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
  - merchandising
  - mutation
input:
  filter:
    type: string
    required: true
    description: >-
      Product filter query (e.g., `tag:summer-2026`, `vendor:Nike`,
      `status:draft`)
  target_status:
    type: string
    required: true
    description: 'Target status: `ACTIVE`, `DRAFT`, or `ARCHIVED`'
  dry_run:
    type: boolean
    required: false
    description: Preview products without executing mutations
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Queries products matching a tag, vendor, collection, or status filter and bulk-transitions them to a target status (DRAFT, ACTIVE, or ARCHIVED). Used for seasonal launches (DRAFT → ACTIVE), end-of-season sunsetting (ACTIVE → ARCHIVED), and pre-launch staging (creating as DRAFT, activating on a date).

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| filter | string | yes | — | Product filter query (e.g., `tag:summer-2026`, `vendor:Nike`, `status:draft`) |
| target_status | string | yes | — | Target status: `ACTIVE`, `DRAFT`, or `ARCHIVED` |
| dry_run | bool | no | true | Preview products without executing mutations |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ⚠️ ARCHIVED products are hidden from all sales channels and cannot be purchased. ACTIVE products are immediately visible to customers. Run with `dry_run: true` to review the product list before committing — especially for ARCHIVED transitions which are hard to reverse in bulk.

## Workflow Steps

1. **OPERATION:** `products` — query
   **Inputs:** `query: <filter>`, `first: 250`, pagination cursor
   **Expected output:** Products with `id`, `title`, `status`, `tags`; paginate until `hasNextPage: false`

2. Filter to products NOT already in `target_status` — skip those already correct

3. **OPERATION:** `productUpdate` — mutation
   **Inputs:** `id: <product_id>`, `status: <target_status>`
   **Expected output:** `product { id, title, status }`, `userErrors`

## GraphQL Operations

```graphql
# products:query — validated against api_version 2025-01
query ProductsByFilter($query: String!, $after: String) {
  products(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        title
        status
        vendor
        tags
        publishedAt
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
# productUpdate:mutation — validated against api_version 2025-01
mutation ProductUpdateStatus($input: ProductInput!) {
  productUpdate(input: $input) {
    product {
      id
      title
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
CSV file `lifecycle_update_<YYYY-MM-DD>.csv` with columns:
`product_id`, `title`, `previous_status`, `new_status`, `vendor`, `tags`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `userErrors` on productUpdate | Product locked or invalid state | Log error, skip product, continue |
| No products match filter | Filter too narrow | Exit with 0 matches, suggest broadening filter |

## Best Practices
- Use tags to mark seasonal batches before running (e.g., tag products with `launch:2026-05` before activating them) so the filter is precise.
- ARCHIVED status removes products from all channels including the storefront, POS, and buy buttons — confirm this is the intent before running at scale.
- For large catalogs (500+ products), rate limiting will slow execution — the skill retries automatically but large batches may take several minutes.
- Pair with `product-data-completeness-score` before activating DRAFT products to ensure they have all required fields.
