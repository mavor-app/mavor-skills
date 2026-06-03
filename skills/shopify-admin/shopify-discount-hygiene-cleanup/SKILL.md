---
name: shopify-discount-hygiene-cleanup
displayName: Discount Hygiene Cleanup
description: >-
  Finds expired, zero-usage, or duplicate discount codes and optionally
  deactivates or deletes them.
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
  flag_expired:
    type: boolean
    required: false
    description: Flag/delete discounts past their end date
  flag_zero_usage:
    type: boolean
    required: false
    description: Flag/delete discounts with 0 redemptions older than N days
  zero_usage_min_age_days:
    type: number
    required: false
    description: Age threshold for zero-usage flags
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
Audits the discount catalog for expired codes, codes with zero redemptions, and duplicate code prefixes. Discount sprawl accumulates over months of campaigns and makes the admin difficult to navigate. Optionally deletes flagged codes. Replaces manual discount cleanup and builds on the `discount-ab-analysis` skill with a write step.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| flag_expired | bool | no | true | Flag/delete discounts past their end date |
| flag_zero_usage | bool | no | true | Flag/delete discounts with 0 redemptions older than N days |
| zero_usage_min_age_days | integer | no | 30 | Age threshold for zero-usage flags |
| dry_run | bool | no | true | Preview without executing mutations |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ⚠️ `discountCodeDelete` permanently removes discount codes. Deleted codes cannot be recovered. Customers who received a deleted code will find it invalid. Run with `dry_run: true` to review the flagged list before committing. Always check that expired codes are not referenced in active email campaigns before deleting.

## Workflow Steps

1. **OPERATION:** `discountNodes` — query
   **Inputs:** `first: 250`, select `discount { ... on DiscountCodeBasic { codes, usageLimit, asyncUsageCount, endsAt, status } }`, pagination cursor
   **Expected output:** All discount codes with usage and expiry data; paginate until `hasNextPage: false`

2. Flag discounts matching: `flag_expired` (status = EXPIRED) and/or `flag_zero_usage` (asyncUsageCount == 0 AND created > `zero_usage_min_age_days` ago)

3. **OPERATION:** `discountCodeDelete` — mutation
   **Inputs:** `id: <discount_node_id>`
   **Expected output:** `deletedCodeDiscountId`, `userErrors`

## GraphQL Operations

```graphql
# discountNodes:query — validated against api_version 2025-01
query DiscountAudit($after: String) {
  discountNodes(first: 250, after: $after) {
    edges {
      node {
        id
        discount {
          ... on DiscountCodeBasic {
            title
            status
            createdAt
            endsAt
            asyncUsageCount
            usageLimit
            codes(first: 5) {
              edges {
                node {
                  id
                  code
                }
              }
            }
          }
          ... on DiscountCodeBxgy {
            title
            status
            createdAt
            endsAt
            asyncUsageCount
            usageLimit
          }
          ... on DiscountCodeFreeShipping {
            title
            status
            createdAt
            endsAt
            asyncUsageCount
            usageLimit
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
# discountCodeDelete:mutation — validated against api_version 2025-01
mutation DiscountCodeDelete($id: ID!) {
  discountCodeDelete(id: $id) {
    deletedCodeDiscountId
    userErrors {
      field
      message
    }
  }
}
```

Zero usage (> <n> days): <n>
  Total flagged:         <n>
  Deleted:               <n>
  Errors:                <n>
  Output:                discount_cleanup_<date>.csv
══════════════════════════════════════════════
```

For `format: json`, emit:
```json
{
  "skill": "discount-hygiene-cleanup",
  "store": "<domain>",
  "started_at": "<ISO8601>",
  "dry_run": true,
  "outcome": {
    "scanned": 0,
    "flagged_expired": 0,
    "flagged_zero_usage": 0,
    "deleted": 0,
    "errors": 0,
    "output_file": "discount_cleanup_<date>.csv"
  }
}
```

## Output Format
CSV file `discount_cleanup_<YYYY-MM-DD>.csv` with columns:
`discount_id`, `title`, `status`, `created_at`, `ends_at`, `usage_count`, `usage_limit`, `flag_reason`, `action`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `userErrors` on delete | Discount already deleted or active order using it | Log error, skip, continue |
| No discounts flagged | Clean discount catalog | Exit with ✅ no cleanup needed |

## Best Practices
- Run quarterly — discount code sprawl accumulates quickly with seasonal campaigns.
- Check with your email marketing team before deleting zero-usage codes — they may be in a scheduled campaign that hasn't launched yet.
- Keep `flag_zero_usage` age at 30+ days to avoid deleting codes from recently launched campaigns.
- Automatic/percentage discounts (not code-based) are not cleaned up by this skill — those are managed separately.
