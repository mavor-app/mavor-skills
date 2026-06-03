---
name: shopify-gift-card-liability-report
displayName: Gift Card Liability Report
description: >-
  Read-only: calculates total outstanding gift card balance as a financial
  liability, broken down by issue cohort and remaining balance band.
version: 1.0.0
category: finance
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
  - finance
input:
  status:
    type: string
    required: false
    description: 'Filter by status: `enabled`, `disabled`, or `all`'
  balance_bands:
    type: string
    required: false
    description: Upper edges of balance bands (in store currency) for distribution table
  stale_days:
    type: number
    required: false
    description: Cards untouched longer than this are flagged as breakage candidates
  as_of:
    type: string
    required: false
    description: ISO date for the "as of" snapshot label on the report
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Calculates the store's total outstanding gift card liability — the sum of unredeemed gift card balances that represent a future obligation to deliver goods. Breaks the liability down by **issue-month cohort** and **remaining-balance band** so finance can size the obligation, age it, and forecast breakage. This is the bookkeeping companion to `gift-card-balance-report` (which lists individual cards). Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| status | string | no | enabled | Filter by status: `enabled`, `disabled`, or `all` |
| balance_bands | array | no | `[10, 50, 100, 250, 500]` | Upper edges of balance bands (in store currency) for distribution table |
| stale_days | integer | no | 365 | Cards untouched longer than this are flagged as breakage candidates |
| as_of | string | no | today (UTC) | ISO date for the "as of" snapshot label on the report |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. The dollar figure produced is the deferred-revenue liability for accounting purposes; review with your accountant before booking journal entries.

## Liability Model

For every enabled gift card with `balance > 0`:

1. **Outstanding balance** = sum of `balance.amount` (the liability)
2. **Issue cohort** = year-month of `createdAt`
3. **Balance band** = first band edge ≥ remaining balance, or `>max` for cards above the largest edge
4. **Breakage candidate** = card with `balance > 0` and (`updatedAt` older than `stale_days` ago OR `expiresOn` within next 30 days)

Aggregations:
- Total outstanding (overall + per cohort + per band)
- Card counts per cohort and per band
- Weighted-average days since issue
- Breakage candidate total — useful for revenue recognition under ASC 606 / IFRS 15 for stores in jurisdictions where breakage can be recognized

## Workflow Steps

1. **OPERATION:** `giftCards` — query
   **Inputs:** `query: "status:<status> balance:>0"`, `first: 250`, select `id`, `balance`, `initialValue`, `createdAt`, `updatedAt`, `expiresOn`, `enabled`, `lastCharacters`, pagination cursor
   **Expected output:** All gift cards with positive balance; paginate until `hasNextPage: false`

2. For each card, compute issue cohort, balance band, and breakage flag

3. Aggregate totals: overall liability, per-cohort table, per-band table, breakage candidate subtotal

4. Compute redeemed-to-date as `Σ(initialValue - balance)` for context

## GraphQL Operations

```graphql
# giftCards:query — validated against api_version 2025-01
query GiftCardLiability($query: String, $after: String) {
  giftCards(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        balance {
          amount
          currencyCode
        }
        initialValue {
          amount
          currencyCode
        }
        enabled
        createdAt
        updatedAt
        expiresOn
        lastCharacters
        customer {
          id
          displayName
          defaultEmailAddress {
            emailAddress
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

## Output Format
CSV file `gift_card_liability_<YYYY-MM-DD>.csv` with columns:
`gift_card_id`, `last_characters`, `initial_value`, `balance`, `redeemed`, `currency`, `created_at`, `issue_cohort`, `balance_band`, `updated_at`, `expires_on`, `breakage_candidate`, `customer_email`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No gift cards with positive balance | Store hasn't issued any, or all redeemed | Exit with $0 liability |
| Multi-currency cards | Cards issued in different presentment currencies | Group totals by currency code; do not sum across currencies |
| Card with `null` `expiresOn` | No expiry policy | Treat as non-expiring; do not include in expiry-based breakage |

## Best Practices
- Run on the **last day of every accounting period** so the figure aligns with your balance-sheet close.
- The total outstanding amount is the **deferred-revenue liability** — book it in your accounting system, do not treat issued gift cards as revenue.
- Breakage policy varies by jurisdiction; consult your accountant before recognizing breakage candidates as revenue. The `stale_days` and `expiresOn` flags here are inputs to that policy, not a substitute for it.
- Track the redemption-rate trend month over month — declining redemption can indicate a customer-experience issue (recipients can't find / remember their cards).
- Pair with `gift-card-issuance` to monitor flow: liability should increase by issuance and decrease by redemption + breakage.
