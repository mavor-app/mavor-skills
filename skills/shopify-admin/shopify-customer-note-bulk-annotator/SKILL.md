---
name: shopify-customer-note-bulk-annotator
displayName: Customer Note Bulk Annotator
description: >-
  Adds internal notes to customer records in bulk — useful for post-campaign
  flags, import annotations, or support context.
version: 1.0.0
category: customer-ops
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
  - customer-ops
  - mutation
input:
  filter:
    type: string
    required: true
    description: 'Customer filter query (e.g., `tag:vip`, `total_spent:>=500`)'
  note:
    type: string
    required: true
    description: Note text to append to matching customers
  append:
    type: boolean
    required: false
    description: Append to existing note (true) or replace entirely (false)
  dry_run:
    type: boolean
    required: false
    description: Preview matching customers without executing mutations
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Queries customers matching a filter (tag, email list, or spend threshold) and appends a note to each customer record. Internal notes are visible to staff in Shopify Admin but not to customers. Used for post-campaign annotation, import source tracking, VIP flags, or support context.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| filter | string | yes | — | Customer filter query (e.g., `tag:vip`, `total_spent:>=500`) |
| note | string | yes | — | Note text to append to matching customers |
| append | bool | no | true | Append to existing note (true) or replace entirely (false) |
| dry_run | bool | no | true | Preview matching customers without executing mutations |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ⚠️ If `append: false`, this overwrites the existing customer note entirely. Existing notes will be lost. Default is `append: true` which safely appends with a timestamp prefix. Run with `dry_run: true` to confirm the customer list before committing.

## Workflow Steps

1. **OPERATION:** `customers` — query
   **Inputs:** `query: <filter>`, `first: 250`, select `id`, `displayName`, `note`, pagination cursor
   **Expected output:** Matching customers with existing notes; paginate until `hasNextPage: false`

2. Construct new note: if `append: true`, prepend `[YYYY-MM-DD] <note>` to existing note (newline-separated); if `append: false`, replace with `<note>`

3. **OPERATION:** `customerUpdate` — mutation
   **Inputs:** `id: <customer_id>`, `note: <new_note>`
   **Expected output:** `customer { id, note }`, `userErrors`

## GraphQL Operations

```graphql
# customers:query — validated against api_version 2025-01
query CustomersByFilter($query: String!, $after: String) {
  customers(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        displayName
        defaultEmailAddress {
          emailAddress
        }
        note
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
# customerUpdate:mutation — validated against api_version 2025-01
mutation CustomerUpdateNote($input: CustomerInput!) {
  customerUpdate(input: $input) {
    customer {
      id
      displayName
      note
    }
    userErrors {
      field
      message
    }
  }
}
```

## Output Format
CSV file `annotation_log_<YYYY-MM-DD>.csv` with columns:
`customer_id`, `name`, `email`, `previous_note`, `new_note`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `userErrors` on customerUpdate | Invalid input or read-only customer | Log error, skip customer, continue |
| No customers match filter | Filter too narrow | Exit with 0 matches |

## Best Practices
- Always use `append: true` unless you explicitly intend to overwrite existing notes — staff notes may contain important history.
- Include a datestamp in the `note` text itself (e.g., `"2026-04-11: Campaign X participant"`) so notes remain interpretable months later.
- Use `dry_run: true` to confirm the customer count before annotating — a broad filter can match thousands of customers unexpectedly.
- For import-source tracking, annotate immediately after the import run to maintain a clear audit trail.
