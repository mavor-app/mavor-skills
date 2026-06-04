---
name: shopify-duplicate-sku-barcode-detector
displayName: Duplicate Sku Barcode Detector
description: 'Read-only: finds duplicate SKUs or barcodes across all product variants.'
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
  check_skus:
    type: boolean
    required: false
    description: Check for duplicate SKUs
  check_barcodes:
    type: boolean
    required: false
    description: Check for duplicate barcodes
  include_blank:
    type: boolean
    required: false
    description: Flag variants with blank/null SKU
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Scans all product variants and identifies duplicate SKUs or barcodes — two or more variants sharing the same identifier. Duplicate SKUs cause inventory sync failures, incorrect order routing, and accounting mismatches. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| check_skus | bool | no | true | Check for duplicate SKUs |
| check_barcodes | bool | no | true | Check for duplicate barcodes |
| include_blank | bool | no | false | Flag variants with blank/null SKU |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `productVariants` — query
   **Inputs:** `first: 250`, select `sku`, `barcode`, `product { title }`, pagination cursor
   **Expected output:** All variants with SKU and barcode values; paginate until `hasNextPage: false`

2. Build in-memory map of `sku → [variants]` and `barcode → [variants]`

3. Report all keys with more than one variant (duplicates)

4. If `include_blank`: additionally flag variants where `sku` is null or empty string

## GraphQL Operations

```graphql
# productVariants:query — validated against api_version 2025-01
query VariantIdentifiers($after: String) {
  productVariants(first: 250, after: $after) {
    edges {
      node {
        id
        sku
        barcode
        title
        product {
          id
          title
          handle
          status
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
CSV file `duplicates_<YYYY-MM-DD>.csv` with columns:
`issue_type`, `duplicate_value`, `variant_id`, `product_title`, `variant_title`, `sku`, `barcode`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No duplicates found | Clean catalog | Exit with ✅ no issues found |

## Best Practices
- Run this skill after every bulk product import — imports are the most common source of duplicate SKUs.
- A shared SKU across products is only valid if you intentionally use the same SKU for reprints or variants — most cases are data errors.
- Blank SKUs are not duplicates but can cause problems with 3PLs and fulfillment systems that require a SKU for every variant — use `include_blank: true` to surface them.
- After identifying duplicates, use the Shopify Admin UI or the `productVariantsBulkUpdate` mutation to correct SKU values.
