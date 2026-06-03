---
name: shopify-collection-membership-audit
displayName: Collection Membership Audit
description: >-
  Read-only: lists orphan products (in zero collections) and over-collected
  products for catalog hygiene.
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
  max_collections:
    type: number
    required: false
    description: Flag products in more than this many collections
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
Identifies products that are not in any collection ("orphans" — invisible in store navigation) and products that appear in an unusually high number of collections ("over-collected" — potential merchandising noise). Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| max_collections | integer | no | 10 | Flag products in more than this many collections |
| status_filter | string | no | active | Product status to scan: `active`, `draft`, or `all` |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `products` — query
   **Inputs:** `query: "status:<status_filter>"`, `first: 250`, select `collections { edges { node { id } } }`, pagination cursor
   **Expected output:** Products with their collection memberships; paginate until `hasNextPage: false`

2. For each product: count collections → flag if 0 (orphan) or > `max_collections` (over-collected)

3. **OPERATION:** `collections` — query (for collection names)
   **Inputs:** `first: 250`, select `id`, `title`, `productsCount`
   **Expected output:** Collection metadata for enriching the report

## GraphQL Operations

```graphql
# products:query — validated against api_version 2025-01
query ProductCollectionMembership($query: String!, $after: String) {
  products(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        title
        handle
        status
        collections(first: 30) {
          edges {
            node {
              id
              title
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
# collections:query — validated against api_version 2025-01
query CollectionOverview($after: String) {
  collections(first: 250, after: $after) {
    edges {
      node {
        id
        title
        handle
        productsCount {
          count
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
CSV file `collection_audit_<YYYY-MM-DD>.csv` with columns:
`product_id`, `title`, `handle`, `status`, `collection_count`, `collections`, `issue`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No orphans found | All products are in collections | Exit with ✅ no orphans found |

## Best Practices
- Orphan active products are invisible in store navigation — customers can only find them via direct URL or search. Prioritize fixing these.
- Automated collections (rule-based) may automatically pull products based on tags or conditions — an orphan in manual collections may still appear in automated ones. Check both.
- Use `max_collections: 5` for stores with a tightly curated navigation; use higher thresholds for marketplace-style stores where cross-listing is intentional.
- Run after seasonal catalog refreshes to ensure all new products are assigned to the right collections.
