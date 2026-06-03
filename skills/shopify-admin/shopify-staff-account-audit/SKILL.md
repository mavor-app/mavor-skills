---
name: shopify-staff-account-audit
displayName: Staff Account Audit
description: >-
  Read-only: reviews staff accounts for stale logins, inactive status, and
  overpermissioned roles to surface security and access hygiene issues.
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
  stale_days:
    type: number
    required: false
    description: Flag accounts with no login activity in this many days
  include_inactive:
    type: boolean
    required: false
    description: 'Include accounts where `active: false` in the audit output'
  include_owner:
    type: boolean
    required: false
    description: Include the shop owner row in flagged-account counts
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Audits all staff member accounts on the store to surface security and access-hygiene risks. Flags accounts that have not logged in for more than `stale_days` days, accounts that are inactive but still provisioned, and accounts with full / shop-owner-equivalent permissions. Read-only — no mutations. Provides the data foundation for a follow-up access review or deprovisioning workflow.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| stale_days | integer | no | 90 | Flag accounts with no login activity in this many days |
| include_inactive | bool | no | true | Include accounts where `active: false` in the audit output |
| include_owner | bool | no | false | Include the shop owner row in flagged-account counts |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time. No staff accounts are deactivated or modified by this skill.

## Workflow Steps

1. **OPERATION:** `staffMembers` — query
   **Inputs:** `first: 250`, select `id`, `name`, `email`, `active`, `isShopOwner`, `accountType`, `locale`, `lastSeen`, pagination cursor
   **Expected output:** All staff members with status and last-login data; paginate until `hasNextPage: false`

2. Compute `days_since_last_seen` per member. Flag any member with `days_since_last_seen > stale_days` as **stale**.

3. Flag any member with `active: false` (or `accountType: SUSPENDED`) as **inactive but provisioned**.

4. Flag any member with `isShopOwner: true` or `accountType: COLLABORATOR` with full permissions as **high privilege** for review.

5. Cross-tabulate: produce per-account record with all flags joined (`stale`, `inactive`, `high_privilege`).

## GraphQL Operations

```graphql
# staffMembers:query — validated against api_version 2025-01
query StaffAccountAudit($after: String) {
  staffMembers(first: 250, after: $after) {
    edges {
      node {
        id
        name
        email
        active
        isShopOwner
        accountType
        locale
        exists
        phone
        avatar {
          url
        }
        privateData {
          accountSettingsUrl
          createdAt
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
CSV file `staff_audit_<YYYY-MM-DD>.csv` with columns:
`staff_id`, `name`, `email`, `account_type`, `is_shop_owner`, `active`, `last_seen`, `days_since_last_seen`, `is_stale`, `is_inactive`, `is_high_privilege`, `flags`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `ACCESS_DENIED` on `staffMembers` | Caller lacks `read_users` or staff-mgmt permission | Re-auth as Shop Owner / staff-admin |
| `lastSeen: null` on a staff member | Account never logged in | Treat as `days_since_last_seen = days_since_account_created`; flag as stale |
| Empty staff list | Single-operator store (owner only) | Exit with 1 row (the owner); skill is still useful for record-keeping |

## Best Practices
- Run quarterly (90-day cadence) as part of routine access reviews. Pair with the offboarding checklist — every former employee should be revoked, not merely deactivated.
- Use `stale_days: 30` for high-risk stores (high-volume, large staff) and `stale_days: 180` for very small teams where seasonal access is normal.
- Sort the CSV by `days_since_last_seen` descending to prioritize the longest-stale accounts first.
- High-privilege accounts (Shop Owner, full-permission collaborators) should have unique strong credentials and 2FA — treat any stale high-privilege account as a P0 review item.
- Export the CSV into your access-review tracker; do not deactivate accounts blindly — confirm with the account holder's manager first.
- Cross-reference flagged stale accounts with recent `staffMember`-scoped audit log events before deprovisioning to ensure there is no in-flight work.
