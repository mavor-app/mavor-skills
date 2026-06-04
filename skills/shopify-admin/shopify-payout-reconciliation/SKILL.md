---
name: shopify-payout-reconciliation
displayName: Payout Reconciliation
description: >-
  Read-only: reconciles Shopify Payments payouts against the order transactions
  that funded them and flags amount discrepancies.
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
  days_back:
    type: number
    required: false
    description: Lookback window covering payouts issued in this period
  tolerance:
    type: number
    required: false
    description: Acceptable delta in store currency before flagging a discrepancy
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Reconciles Shopify Payments payouts to the order transactions that contributed to them. For each payout, sums gross sales, refunds, adjustments, and fees, and compares the computed net to the payout's reported `net` amount. Discrepancies are flagged with a delta and the suspected cause. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| days_back | integer | no | 30 | Lookback window covering payouts issued in this period |
| tolerance | number | no | 0.01 | Acceptable delta in store currency before flagging a discrepancy |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Reconciliation output is informational; do not treat flagged discrepancies as confirmed errors before reviewing the underlying transactions in the Shopify admin.

## Workflow Steps

1. **OPERATION:** `shopifyPaymentsAccount` — query
   **Inputs:** select `payouts(first: 100, query: "issued_at:>='<NOW - days_back days>'")` with `id`, `issuedAt`, `status`, `net`, `gross`, `summary { chargesGross, chargesFee, refundsGross, refundsFee, adjustmentsGross, adjustmentsFee, retriedPayoutsGross, retriedPayoutsFee }`
   **Expected output:** All payouts in the window. If account is null, exit — store does not use Shopify Payments.

2. For each payout, compute reconciliation expectation:
   ```
   expected_net = chargesGross - chargesFee
                - refundsGross + refundsFee   (refundsFee is normally negative / reversed)
                + adjustmentsGross - adjustmentsFee
                + retriedPayoutsGross - retriedPayoutsFee
   ```
   `delta = reported_net - expected_net`

3. **OPERATION:** `orders` — query (only for flagged payouts to drill down)
   **Inputs:** `query: "transactions:'gateway:shopify_payments processed_at:>=<payout.issuedAt - 7d> processed_at:<=<payout.issuedAt + 1d>'"`, `first: 250`
   **Expected output:** Candidate orders that may have contributed to the payout, used for an order-level cross-check on top discrepancies

4. Classify each payout:
   - `ok` if `|delta| <= tolerance`
   - `discrepancy` otherwise — record sign (positive: payout overpaid us; negative: payout underpaid)

5. Aggregate totals across the window: total payouts, total reconciled, total discrepancies, sum of absolute deltas

## GraphQL Operations

```graphql
# shopifyPaymentsAccount:query — validated against api_version 2025-01
query PayoutReconciliation($payoutQuery: String!, $payoutAfter: String) {
  shopifyPaymentsAccount {
    id
    payoutSchedule { interval }
    payouts(first: 100, after: $payoutAfter, query: $payoutQuery) {
      edges {
        node {
          id
          issuedAt
          status
          net { amount currencyCode }
          gross { amount currencyCode }
          summary {
            chargesGross { amount currencyCode }
            chargesFee { amount currencyCode }
            refundsFeeGross { amount currencyCode }
            refundsFee { amount currencyCode }
            adjustmentsGross { amount currencyCode }
            adjustmentsFee { amount currencyCode }
            retriedPayoutsGross { amount currencyCode }
            retriedPayoutsFee { amount currencyCode }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
```

```graphql
# orders:query — validated against api_version 2025-01
query OrdersFundingPayout($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        processedAt
        totalPriceSet { shopMoney { amount currencyCode } }
        totalReceivedSet { shopMoney { amount currencyCode } }
        transactions {
          id
          gateway
          kind
          status
          processedAt
          amountSet { shopMoney { amount currencyCode } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

## Output Format
CSV file `payout_reconciliation_<YYYY-MM-DD>.csv` with columns:
`payout_id`, `issued_at`, `status`, `reported_net`, `expected_net`, `delta`, `currency`, `charges_gross`, `charges_fee`, `refunds_gross`, `refunds_fee`, `adjustments_gross`, `verdict`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| `shopifyPaymentsAccount` is null | Store does not use Shopify Payments | Exit cleanly; suggest reconciling via the third-party gateway dashboard |
| Currency mismatch within payout | Multi-currency store | Reconcile only payouts in the presentment currency that matches account currency; flag others as `currency_mismatch` |
| Payout still `IN_TRANSIT` | Not yet final | Skip — reconcile after status moves to `PAID` |

## Best Practices
- Run weekly on the morning after a payout is scheduled — same-day reconciliation catches discrepancies while transactions are easy to investigate.
- For any flagged discrepancy, drill in: refunds processed inside the payout window often show up in the next payout's `refundsGross`, which can look like an underpayment if you forget to reconcile across windows.
- Use this skill alongside your accounting export — these numbers should match your bookkeeping software's deposit records to the cent.
- Tolerance > $0.01 should be used cautiously: anything above a few cents typically reflects a real fee or adjustment that deserves an explanation.
- This skill does not detect fraud; it detects accounting deltas. If you suspect fraud, escalate via the Shopify admin's payout detail view.
