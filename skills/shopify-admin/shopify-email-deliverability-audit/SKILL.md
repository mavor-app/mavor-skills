---
name: shopify-email-deliverability-audit
displayName: Email Deliverability Audit
description: >-
  Read-only: scans the customer database for malformed emails, role accounts,
  disposable domains, and bounce-suspect patterns to protect sender reputation.
version: 1.0.0
category: customer-ops
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
  - customer-ops
input:
  marketing_consent_only:
    type: boolean
    required: false
    description: >-
      Only scan customers who currently accept marketing — those are the ones at
      risk of being mailed
  disposable_domains:
    type: string
    required: false
    description: Override built-in disposable-domain list
  role_localparts:
    type: string
    required: false
    description: Local-part prefixes to flag as role accounts
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Scans the entire customer list and flags addresses that will hurt email deliverability if included in marketing sends: syntactically invalid addresses, role accounts (info@, admin@, sales@), known disposable / temporary domains, and suspected hard-bounce patterns. Output is a suppression list ready to import into your email platform. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| marketing_consent_only | bool | no | true | Only scan customers who currently accept marketing — those are the ones at risk of being mailed |
| disposable_domains | array | no | built-in list | Override built-in disposable-domain list |
| role_localparts | array | no | `["info","admin","sales","support","contact","noreply","help","webmaster","postmaster"]` | Local-part prefixes to flag as role accounts |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time. No emails are sent, no marketing consent is changed.

## Detection Rules

For each customer email, run these checks in order and assign one or more flags:

1. **`invalid_syntax`** — fails RFC 5322 local-part / domain validation, missing `@`, contains whitespace, double dots, leading/trailing dot
2. **`role_account`** — local part exactly matches a `role_localparts` entry (case-insensitive)
3. **`disposable_domain`** — domain matches the disposable-domain list (mailinator, guerrillamail, tempmail-style domains, etc.)
4. **`plus_alias`** — contains `+` in local part (informational; not a deliverability problem on its own, but useful for de-duplication)
5. **`bounce_suspect`** — heuristics: numeric-only local part, length > 64 chars, ALL-CAPS, repeated characters (`aaaaa`), keyboard rolls (`asdfghjk`)
6. **`duplicate`** — same normalized email already seen in the customer set

A customer can carry multiple flags; the most severe (`invalid_syntax` > `bounce_suspect` > `disposable_domain` > `role_account` > `plus_alias`) drives the recommended action.

## Workflow Steps

1. **OPERATION:** `customers` — query
   **Inputs:** `first: 250`, select `id`, `defaultEmailAddress { emailAddress, marketingState }`, `numberOfOrders`, `tags`, pagination cursor. If `marketing_consent_only: true`, filter `query: "email_marketing_state:subscribed"`
   **Expected output:** All targeted customers with email; paginate until `hasNextPage: false`

2. Run detection rules over each email; collect flags

3. Aggregate counts per flag, build suppression list

## GraphQL Operations

```graphql
# customers:query — validated against api_version 2025-01
query DeliverabilityAudit($query: String, $after: String) {
  customers(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        displayName
        defaultEmailAddress {
          emailAddress
          marketingState
        }
        numberOfOrders
        amountSpent {
          amount
          currencyCode
        }
        tags
        createdAt
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
CSV file `deliverability_audit_<YYYY-MM-DD>.csv` with columns:
`customer_id`, `email`, `flags`, `recommended_action`, `marketing_state`, `order_count`, `total_spent`, `created_at`

`recommended_action` is one of: `suppress`, `review`, `keep`.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Customer with no email | Phone-only / POS account | Skip, do not include in suppression list |
| Disposable list out of date | New temp-mail domain not in built-in list | Caller can override via `disposable_domains` parameter |
| Unicode local parts | Internationalized email addresses | Normalize via NFC; do not flag valid IDN domains |

## Best Practices
- Run before every large promotional send — high invalid / bounce rates above 2% put your sending domain reputation at risk.
- Treat `role_account` flags as soft-suppression: those addresses rarely consent to marketing meaningfully and frequently mark mail as spam.
- Re-audit quarterly even if the customer list is static — domain reputation lists change, and disposable-email providers add new domains.
- Pair with `marketing-consent-report` to confirm consent state aligns with what your email service provider has on file.
- Hand the resulting suppression CSV to your email service provider's import-suppression-list feature; do not silently delete customers from Shopify based on this audit.
