---
name: shopify-return-processing-sla
displayName: Return Processing Sla
description: >-
  Read-only: measures average time from return request to refund completion,
  surfacing SLA breaches.
version: 1.0.0
category: returns
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
  - returns
input:
  days_back:
    type: number
    required: false
    description: Lookback window for return requests
  sla_days:
    type: number
    required: false
    description: Maximum acceptable days from request to refund
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Calculates the time from return request creation to refund issuance for all completed returns in a period. Surfaces the average processing time, identifies orders that breached a configurable SLA threshold, and lists the longest-pending open returns. Read-only — no mutations.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| days_back | integer | no | 30 | Lookback window for return requests |
| sla_days | integer | no | 5 | Maximum acceptable days from request to refund |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `returns` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, pagination cursor
   **Expected output:** Returns with `createdAt`, `status`, `refunds { createdAt }`, `order { name }`

2. For each completed return: calculate `processing_days = refund.createdAt - return.createdAt`

3. Identify SLA breaches: `processing_days > sla_days`

4. **OPERATION:** `orders` — query
   **Inputs:** Filter for orders with `return_status:open` to find pending returns exceeding SLA
   **Expected output:** Open return orders with request dates

## GraphQL Operations

```graphql
# returns:query — validated against api_version 2025-01
query ReturnProcessingTimes($query: String!, $after: String) {
  returns(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        status
        createdAt
        order {
          id
          name
        }
        refunds(first: 3) {
          id
          createdAt
          totalRefundedSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
        returnLineItems(first: 10) {
          edges {
            node {
              quantity
              returnReason
            }
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
# orders:query — validated against api_version 2025-01
query OrdersWithOpenReturns($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        returnStatus
        returns(first: 5) {
          edges {
            node {
              id
              status
              createdAt
            }
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
CSV file `return_sla_<YYYY-MM-DD>.csv` with columns:
`return_id`, `order_name`, `return_requested_at`, `refunded_at`, `processing_days`, `sla_breach`, `return_status`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No refund on completed return | Exchange-only resolution | Exclude from time calculation, note as exchange |
| No returns in window | No return activity | Exit with summary: 0 returns |

## Best Practices
- Set `sla_days` to match your published returns policy (e.g., "refunds processed within 5 business days").
- Use the open returns list to proactively contact customers whose returns have been waiting more than `sla_days` — reducing WISMO-style "where's my refund" tickets.
- Run weekly as a returns ops health check; pair with `return-reason-analysis` to correlate slow processing with specific return reason types.
- Note that `processing_days` measures calendar days; adjust your SLA threshold accordingly if your team only processes returns on business days.
