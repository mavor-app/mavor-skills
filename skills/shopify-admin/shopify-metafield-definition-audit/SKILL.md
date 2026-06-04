---
name: shopify-metafield-definition-audit
displayName: Metafield Definition Audit
description: >-
  Read-only: enumerates every metafield definition across all owner types and
  flags unused, undocumented, or duplicate-key definitions.
version: 1.0.0
category: store-management
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
  - store-management
input:
  owner_types:
    type: string
    required: false
    description: >-
      Comma-separated owner types to scan (e.g. `PRODUCT,CUSTOMER`); `all` scans
      every supported type
  flag_unused:
    type: boolean
    required: false
    description: Flag definitions whose `metafieldsCount` is zero
  flag_undocumented:
    type: boolean
    required: false
    description: Flag definitions with empty/null `description`
  flag_duplicates:
    type: boolean
    required: false
    description: Flag `namespace.key` pairs that exist on more than one owner type
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Inventories every metafield definition (PRODUCT, VARIANT, CUSTOMER, ORDER, COLLECTION, COMPANY, LOCATION, and others) and flags definitions that are unused (zero values stored), undocumented (missing description), or share a `namespace.key` collision across owner types. Definition sprawl is a leading source of theme/app bugs and slow Admin search. Read-only — no mutations. Provides the data foundation for a definition-cleanup workflow.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| owner_types | string | no | all | Comma-separated owner types to scan (e.g. `PRODUCT,CUSTOMER`); `all` scans every supported type |
| flag_unused | bool | no | true | Flag definitions whose `metafieldsCount` is zero |
| flag_undocumented | bool | no | true | Flag definitions with empty/null `description` |
| flag_duplicates | bool | no | true | Flag `namespace.key` pairs that exist on more than one owner type |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time. No metafield definitions are deleted, updated, or pinned by this skill.

## Workflow Steps

1. Determine the list of owner types to scan from `owner_types` (default: full list).

2. **OPERATION:** `metafieldDefinitions` — query
   **Inputs:** For each owner type: `first: 250`, `ownerType: <TYPE>`, select `id`, `namespace`, `key`, `name`, `description`, `type { name }`, `pinnedPosition`, `metafieldsCount`, `validations { name value }`, pagination cursor
   **Expected output:** All definitions per owner type with usage counts; paginate until `hasNextPage: false`

3. Build flag set per definition:
   - `unused` — `metafieldsCount == 0` and `flag_unused: true`
   - `undocumented` — `description` is null or empty and `flag_undocumented: true`
   - `duplicate_key` — `namespace.key` appears on more than one owner type and `flag_duplicates: true`

4. Group results by owner type for the report and emit per-flag summaries.

## GraphQL Operations

```graphql
# metafieldDefinitions:query — validated against api_version 2025-01
query MetafieldDefinitionAudit($ownerType: MetafieldOwnerType!, $after: String) {
  metafieldDefinitions(first: 250, after: $after, ownerType: $ownerType) {
    edges {
      node {
        id
        namespace
        key
        name
        description
        ownerType
        pinnedPosition
        metafieldsCount
        type {
          name
          category
        }
        validations {
          name
          value
          type
        }
        access {
          admin
          storefront
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
CSV file `metafield_def_audit_<YYYY-MM-DD>.csv` with columns:
`definition_id`, `owner_type`, `namespace`, `key`, `name`, `type`, `description_present`, `metafields_count`, `pinned`, `is_unused`, `is_undocumented`, `is_duplicate_key`, `flags`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `ACCESS_DENIED` for an owner type | Caller lacks the read scope for that resource | Skip that owner type with a warning row in the CSV |
| `metafieldsCount` returns null | Owner type does not expose count, or count is still computing | Treat as `unknown`; do not flag as `unused` |
| Owner type not supported in API version | Newer owner type not yet available | Skip with warning; re-run after API version upgrade |

## Best Practices
- Run quarterly and after any app install/uninstall — apps frequently leave behind their definitions when removed.
- Do NOT bulk-delete unused definitions without first searching the storefront theme for references to that `namespace.key`. Theme liquid may read a definition that has zero saved values yet (e.g., a newly added field that has not been populated).
- Pin the most-used definitions (`pinnedPosition` set) to surface them in the merchant Admin UI; un-pinned but heavily used definitions are a UX smell.
- Duplicate keys across owner types are not always wrong (e.g., `custom.notes` on both ORDER and CUSTOMER may be intentional) but they almost always indicate copy-paste creation — review for consistency in `type` and `validations`.
- Pair with a metafield-value sampling skill (per owner type) before any cleanup to confirm true zero usage; counts can lag in fresh stores.
- Keep the CSV in version control alongside theme/app schema docs — the diff over time is the cleanest record of catalog-data evolution.
