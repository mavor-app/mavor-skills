---
name: shopify-compare-at-price-cleanup
displayName: Compare At Price Cleanup
description: >-
  Removes stale compareAtPrice values where current price >= compareAtPrice (no
  real discount) or compareAtPrice has been set for over a configurable age
  threshold.
version: 1.0.0
category: merchandising
runtime:
  type: llm
  executor: auto
capabilities:
  tools:
    - shopify_graphql_query
  permissions:
    - shop.price.update
    - shop.product.write
    - shop.read
tags:
  - shopify
  - merchandising
  - mutation
input:
  dry_run:
    type: boolean
    required: false
    description: Preview the cleanup without executing mutations
  clean_no_discount:
    type: boolean
    required: false
    description: Clear `compareAtPrice` when `price >= compareAtPrice`
  clean_stale:
    type: boolean
    required: false
    description: Clear `compareAtPrice` set longer than `max_age_days`
  max_age_days:
    type: number
    required: false
    description: >-
      Age threshold in days for the stale rule (uses variant `updatedAt` as
      proxy)
  collection_id:
    type: string
    required: false
    description: Optional collection GID to scope the cleanup
  tag_filter:
    type: string
    required: false
    description: Optional product tag to scope the cleanup
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Identifies variants with a `compareAtPrice` that no longer represents a genuine discount and clears it, so storefront strikethrough pricing reflects real savings rather than legacy noise. Two conditions are flagged: (a) `compareAtPrice <= price` (no discount, often left over from a price increase), and (b) `compareAtPrice` set for longer than `max_age_days` (stale "always on sale" optics that hurt long-term price perception and can violate advertising standards in some regions). Defaults to dry-run.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| dry_run | bool | no | true | Preview the cleanup without executing mutations |
| clean_no_discount | bool | no | true | Clear `compareAtPrice` when `price >= compareAtPrice` |
| clean_stale | bool | no | true | Clear `compareAtPrice` set longer than `max_age_days` |
| max_age_days | integer | no | 90 | Age threshold in days for the stale rule (uses variant `updatedAt` as proxy) |
| collection_id | string | no | — | Optional collection GID to scope the cleanup |
| tag_filter | string | no | — | Optional product tag to scope the cleanup |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ⚠️ Step 2 executes `productVariantsBulkUpdate` mutations that overwrite `compareAtPrice` to null. The original strikethrough value is not preserved server-side — record the dry-run CSV before committing if you want a restore path. Always start with `dry_run: true` and review the CSV before running with `dry_run: false`.

## Workflow Steps

1. **OPERATION:** `productVariants` — query
   **Inputs:** `first: 250`, `query: <built from collection_id or tag_filter>`, select `price`, `compareAtPrice`, `updatedAt`, `product { id, title, vendor }`, `sku`, pagination cursor
   **Expected output:** All variants in scope with current pricing; paginate until `hasNextPage: false`

2. Filter to variants meeting either rule: `clean_no_discount` AND `compareAtPrice != null` AND `parseFloat(compareAtPrice) <= parseFloat(price)`, OR `clean_stale` AND `compareAtPrice != null` AND `(now - updatedAt) > max_age_days`. Group by `product.id` for batched mutation.

3. **OPERATION:** `productVariantsBulkUpdate` — mutation (skipped when `dry_run: true`)
   **Inputs:** Per product, `productId` plus `[{ id: variantId, compareAtPrice: null }]`
   **Expected output:** Updated variants with `compareAtPrice` set to null; collect `userErrors` per batch

4. Write the CSV (always, even on dry run) for audit trail and revert capability.

## GraphQL Operations

```graphql
# productVariants:query — validated against api_version 2025-01
query VariantsForCompareAtCleanup($query: String, $after: String) {
  productVariants(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        sku
        price
        compareAtPrice
        updatedAt
        product {
          id
          title
          vendor
          tags
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
# productVariantsBulkUpdate:mutation — validated against api_version 2025-01
mutation ClearCompareAtPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants {
      id
      price
      compareAtPrice
    }
    userErrors {
      field
      message
    }
  }
}
```

## Output Format
CSV file `compare_at_cleanup_<YYYY-MM-DD>.csv` with columns:
`variant_id`, `product_id`, `product_title`, `vendor`, `sku`, `price`, `original_compare_at_price`, `rule_matched`, `variant_updated_at`, `mutation_status`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `userErrors` in mutation response | Variant locked or in active subscription contract | Log per-variant error, continue with remaining variants |
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `compareAtPrice` already null mid-run | Another process cleared it concurrently | Skip, count as no-op success |
| `updatedAt` newer than expected | Concurrent edit during the audit | Re-query single variant before mutation; skip if rule no longer matches |

## Best Practices
1. Always run with `dry_run: true` first and review the CSV. There is no bulk undo for compareAtPrice clearing.
2. Disable `clean_stale` (set `clean_stale: false`) during long planned promotions — your "stale" sale is actually intentional.
3. Use `collection_id` to scope the cleanup to evergreen products and exclude an active sale collection.
4. After running live, spot-check 5–10 variants in the storefront to confirm strikethrough pricing is gone.
5. Schedule a quarterly run as part of catalog hygiene; combine with `seo-metadata-audit` and `product-data-completeness-score` for an end-of-quarter merchandising sweep.
