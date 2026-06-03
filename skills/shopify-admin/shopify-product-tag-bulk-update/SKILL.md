---
name: shopify-product-tag-bulk-update
displayName: Product Tag Bulk Update
description: >-
  Add or remove tags on all products matching a collection, existing tag, or
  search query — for campaign setup, teardown, or catalog organization.
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
  action:
    type: string
    required: true
    description: '`add` or `remove`'
  tags:
    type: string
    required: true
    description: >-
      One or more tag strings to add or remove (e.g., `["summer-sale",
      "clearance"]`)
  collection_id:
    type: string
    required: false
    description: GID of a collection — target all products in this collection
  filter_tag:
    type: string
    required: false
    description: Target all products that currently have this tag
  query_filter:
    type: string
    required: false
    description: 'Shopify product search query (e.g., `"product_type:Apparel"`)'
---
## Purpose
Adds or removes one or more tags across a set of products in bulk — replacing manual product-by-product editing in the Shopify admin. Use for campaign setup (add `summer-sale` to a collection before launch), campaign teardown (remove `flash-sale` after it ends), or catalog reorganization (retag products moving between categories). Tags drive collection rules, marketing segments, and reporting filters, so bulk accuracy matters. Replaces manual Shopify admin bulk editing and CSV import/export workflows.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters
Universal (store, format, dry_run) + skill-specific:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| action | string | yes | — | `add` or `remove` |
| tags | array | yes | — | One or more tag strings to add or remove (e.g., `["summer-sale", "clearance"]`) |
| collection_id | string | no* | — | GID of a collection — target all products in this collection |
| filter_tag | string | no* | — | Target all products that currently have this tag |
| query_filter | string | no* | — | Shopify product search query (e.g., `"product_type:Apparel"`) |

*One of `collection_id`, `filter_tag`, or `query_filter` is required.

## Safety

> ⚠️ Step 2 executes bulk tag mutations. `tagsRemove` is irreversible — if you remove the wrong tag, you must re-add it manually or run this skill again with `action: add`. Run with `dry_run: true` to see the full product list before committing. For large catalogs (1000+ products), dry_run is strongly recommended before any removal operation.

## Workflow Steps

1. **OPERATION:** `products` — query
   **Inputs:** `first: 250`, `query` built from `collection_id`, `filter_tag`, or `query_filter`; paginate until all matching products fetched
   **Expected output:** List of product GIDs and current tag arrays; confirm target set before proceeding

2. **OPERATION:** `tagsAdd` — mutation (if `action: add`)
   **Inputs:** `id: <productId>`, `tags: <tags array>` per product
   **Expected output:** Updated `node.id` with `userErrors`

   **OR**

2. **OPERATION:** `tagsRemove` — mutation (if `action: remove`)
   **Inputs:** `id: <productId>`, `tags: <tags array>` per product
   **Expected output:** Updated node with `userErrors`

## GraphQL Operations

```graphql
# products:query — validated against api_version 2025-01
query ProductsForTagUpdate($first: Int!, $after: String, $query: String) {
  products(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        title
        tags
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
# tagsAdd:mutation — validated against api_version 2025-01
mutation TagsAdd($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node {
      id
    }
    userErrors {
      field
      message
    }
  }
}
```

```graphql
# tagsRemove:mutation — validated against api_version 2025-01
mutation TagsRemove($id: ID!, $tags: [String!]!) {
  tagsRemove(id: $id, tags: $tags) {
    node {
      id
    }
    userErrors {
      field
      message
    }
  }
}
```

## Output Format
CSV file `tag-update-<YYYY-MM-DD>.csv` with columns: `product_id`, `product_title`, `action`, `tags_changed`, `previous_tags`, `result`.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| No products returned | Filter matches nothing | Check collection GID or filter_tag spelling |
| `userErrors` from tagsAdd/tagsRemove | Tag string too long or invalid characters | Shopify tag max length is 255 characters; no commas allowed |
| Large product count (1000+) | Many API calls needed for pagination | Expected — the skill paginates automatically; may take longer |
| Tag not present (on remove) | Product doesn't have the tag you're removing | Silently skips — `tagsRemove` on a non-existent tag is a no-op |

## Best Practices
1. Run `dry_run: true` before any `action: remove` — the CSV preview shows exactly which products will lose the tag.
2. To set up a campaign cleanly, run `action: add` at launch and `action: remove` at the end — keeping your product tags tidy prevents collection rule drift.
3. Use `query_filter: "tag:old-campaign-name"` for teardown — it will find exactly the products tagged from the previous run.
4. You can add multiple tags in one run — pass `tags: ["sale", "homepage-featured", "clearance"]` to apply all three atomically.
5. Tags are case-insensitive in Shopify collection rules but case-preserving in the API — use consistent casing to avoid duplicates like `Sale` and `sale`.
