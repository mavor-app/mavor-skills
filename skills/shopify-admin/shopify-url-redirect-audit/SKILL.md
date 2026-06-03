---
name: shopify-url-redirect-audit
displayName: Url Redirect Audit
description: >-
  Read-only: lists all URL redirects, flags redirect chains (A→B→C) and
  duplicate targets.
version: 1.0.0
category: store-management
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
  - store-management
  - mutation
input:
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Queries all URL redirects in the store and identifies redirect chains (where redirect target A is itself redirected to B), duplicate targets (multiple paths pointing to the same destination), and orphaned redirects (pointing to non-existent pages). Redirect chains add latency and hurt SEO. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `urlRedirects` — query
   **Inputs:** `first: 250`, pagination cursor
   **Expected output:** All redirects with `fromPath`, `target`; paginate until `hasNextPage: false`

2. Build path map: `fromPath → target`

3. Detect chains: for each redirect, check if `target` appears as a `fromPath` in any other redirect

4. Detect duplicates: targets with more than one source path

## GraphQL Operations

```graphql
# urlRedirects:query — validated against api_version 2025-01
query URLRedirects($after: String) {
  urlRedirects(first: 250, after: $after) {
    edges {
      node {
        id
        path
        target
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
CSV file `redirect_audit_<YYYY-MM-DD>.csv` with columns:
`redirect_id`, `from_path`, `target`, `issue_type`, `chain_path`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No redirects | New store or clean setup | Exit with ✅ no redirects found |

## Best Practices
- Redirect chains (A→B→C) add an extra HTTP round-trip — consolidate them to a direct redirect (A→C).
- After fixing chains or removing duplicates, use Shopify Admin → Navigation → URL Redirects to make the corrections. Bulk deletion is not available in the Admin API but individual redirects can be deleted via `urlRedirectDelete` mutation.
- Run after every major store migration or product/collection restructuring where URLs change in bulk.
