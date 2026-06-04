---
name: shopify-metafield-bulk-update
displayName: Metafield Bulk Update
description: >-
  Bulk set or delete metafields on products, variants, or customers filtered by
  tag or collection.
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
  resource_type:
    type: string
    required: false
    description: 'Resource to update: `product`, `variant`, or `customer`'
  filter:
    type: string
    required: true
    description: 'Filter query (e.g., `tag:summer-2026`, `vendor:Nike`)'
  namespace:
    type: string
    required: true
    description: 'Metafield namespace (e.g., `custom`)'
  key:
    type: string
    required: true
    description: 'Metafield key (e.g., `material`)'
  value:
    type: string
    required: false
    description: 'Value to set. If omitted and `action: delete`, metafield is deleted'
  value_type:
    type: string
    required: false
    description: >-
      Metafield type (e.g., `single_line_text_field`, `boolean`,
      `number_integer`)
  action:
    type: string
    required: false
    description: '`set` or `delete`'
  dry_run:
    type: boolean
    required: false
    description: Preview without executing mutations
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Queries products (or variants, or customers) matching a filter and bulk-sets or bulk-deletes metafield values. Used for structured data updates like material composition, care instructions, product specifications, or custom attributes that power storefront features.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| resource_type | string | no | product | Resource to update: `product`, `variant`, or `customer` |
| filter | string | yes | — | Filter query (e.g., `tag:summer-2026`, `vendor:Nike`) |
| namespace | string | yes | — | Metafield namespace (e.g., `custom`) |
| key | string | yes | — | Metafield key (e.g., `material`) |
| value | string | no | — | Value to set. If omitted and `action: delete`, metafield is deleted |
| value_type | string | no | single_line_text_field | Metafield type (e.g., `single_line_text_field`, `boolean`, `number_integer`) |
| action | string | no | set | `set` or `delete` |
| dry_run | bool | no | true | Preview without executing mutations |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ⚠️ `metafieldsSet` overwrites existing metafield values — there is no merge. `metafieldsDelete` permanently removes the metafield value from the resource. Run with `dry_run: true` to confirm the affected product list and verify namespace/key are correct before committing.

## Workflow Steps

1. **OPERATION:** `products` — query
   **Inputs:** `query: <filter>`, `first: 250`, select metafield values for the target namespace/key, pagination cursor
   **Expected output:** Products with existing metafield values (for reference); paginate until `hasNextPage: false`

2. **OPERATION:** `metafieldsSet` — mutation (if `action: set`)
   **Inputs:** Array of `{ ownerId, namespace, key, value, type }` objects
   **Expected output:** `metafields { id, key, value }`, `userErrors`

3. **OPERATION:** `metafieldsDelete` — mutation (if `action: delete`)
   **Inputs:** Array of `{ ownerId, namespace, key }` objects
   **Expected output:** `deletedMetafields { ownerId }`, `userErrors`

## GraphQL Operations

```graphql
# products:query — validated against api_version 2025-01
query ProductsWithMetafield($query: String!, $namespace: String!, $key: String!, $after: String) {
  products(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        title
        metafield(namespace: $namespace, key: $key) {
          id
          value
          type
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
# metafieldsSet:mutation — validated against api_version 2025-01
mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      namespace
      key
      value
      type
      owner {
        ... on Product {
          id
          title
        }
      }
    }
    userErrors {
      field
      message
      code
    }
  }
}
```

```graphql
# metafieldsDelete:mutation — validated against api_version 2025-01
mutation MetafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) {
    deletedMetafields {
      ownerId
      namespace
      key
    }
    userErrors {
      field
      message
    }
  }
}
```

## Output Format
CSV file `metafield_update_<YYYY-MM-DD>.csv` with columns:
`resource_type`, `resource_id`, `title`, `namespace`, `key`, `old_value`, `new_value`, `action`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `userErrors` — invalid type | `value` doesn't match `value_type` | Log error, skip resource, continue |
| `userErrors` — namespace/key not found on delete | Metafield doesn't exist | Log as skipped (already absent) |
| No products match filter | Filter too narrow | Exit with 0 matches |

## Best Practices
- `metafieldsSet` is batched — the mutation accepts up to 25 metafields per call. The skill automatically batches large product sets.
- Always verify the `namespace` and `key` match your store's metafield definitions — typos create orphaned metafields that don't connect to any theme feature.
- For storefront-powered metafields (e.g., displayed in product templates), confirm the theme reads the correct namespace/key before running at scale.
- Use `dry_run: true` to preview exactly which products and current values will be affected before overwriting.
