---
name: shopify-fulfillment-status-digest
displayName: Fulfillment Status Digest
description: >-
  Generate a daily fulfillment triage digest: all open orders segmented by
  fulfillment age and flagged for holds or exceptions.
version: 1.0.0
category: fulfillment-ops
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
  - fulfillment-ops
input:
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
  dry_run:
    type: boolean
    required: false
    description: Preview operations without executing mutations
  aging_thresholds_days:
    type: string
    required: false
    description: >-
      Day boundaries for age buckets (e.g., `[1,3,7]` creates: 0–1d, 1–3d, 3–7d,
      7d+)
  include_holds:
    type: boolean
    required: false
    description: Include orders with active fulfillment holds in a separate section
  limit:
    type: number
    required: false
    description: Maximum orders to fetch per page
---
## Purpose
Produces a daily ops triage digest of all unfulfilled and partially-fulfilled orders, segmented by how long they've been waiting. Flags orders with active holds. Replaces the manual process of scrolling through the Shopify admin Orders page to find aging orders and exceptions — this skill fetches every open order, computes its age, buckets it into configurable time segments, and surfaces any orders currently on a fulfillment hold, giving the ops team a complete exception queue in a single read-only operation.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| format | string | no | human | Output format: `human` or `json` |
| dry_run | bool | no | false | Preview operations without executing mutations |
| aging_thresholds_days | array | no | [1, 3, 7] | Day boundaries for age buckets (e.g., `[1,3,7]` creates: 0–1d, 1–3d, 3–7d, 7d+) |
| include_holds | bool | no | true | Include orders with active fulfillment holds in a separate section |
| limit | integer | no | 250 | Maximum orders to fetch per page |

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `first: <limit>`, `query: "fulfillment_status:unfulfilled OR fulfillment_status:partial"`, sort by `CREATED_AT` ascending (oldest first), paginate until complete
   **Expected output:** All open orders with `createdAt`, `name`, `displayFulfillmentStatus`; compute age = now − `createdAt` in days; bucket into aging_thresholds_days segments

2. **OPERATION:** `fulfillmentOrders` — query (via nested `order.fulfillmentOrders`)
   **Inputs:** For each order from Step 1: `fulfillmentOrders(first: 5)` to check `status` and `requestStatus`; flag any with `status: ON_HOLD`
   **Expected output:** Hold status per order, `holdUntil` if set; contribute to the Holds section of the digest

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query FulfillmentStatusDigest($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
    edges {
      node {
        id
        name
        createdAt
        displayFulfillmentStatus
        displayFinancialStatus
        totalPriceSet {
          shopMoney { amount currencyCode }
        }
        customer {
          id
          firstName
          lastName
        }
        fulfillmentOrders(first: 5) {
          edges {
            node {
              id
              status
              requestStatus
              fulfillAt
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

Note: `fulfillmentOrders` is a nested field on the `Order` type — the `fulfillmentOrders:query` frontmatter entry documents that this operation accesses fulfillment order data.

## Output Format

**Fulfillment Age Digest — `<store>` — `<date>`**
| Age Bucket | Order Count | Oldest Order |
|-----------|-------------|--------------|
| 0–1 days | n | #XXXX |
| 1–3 days | n | #XXXX |
| 3–7 days | n | #XXXX |
| 7+ days  | n | #XXXX (⚠️ review) |

**Orders On Hold** (if `include_holds: true` and holds exist):
| Order | Hold Since | Fulfillment Status |
|-------|-----------|-------------------|
| #XXXX | 3 days | ON_HOLD |

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| No orders returned | No open orders in system | Store is fully fulfilled — no action needed |
| `fulfillmentOrders` returns empty | Order has no fulfillment assignments yet | Order may not have been assigned to a location |
| Rate limit (429) | Large order volume with pagination | Reduce `limit` to 100 |

## Best Practices
1. Run this digest first thing each morning before processing any orders — it gives you the exception queue in one view.
2. Orders in the 7d+ bucket are your highest priority; investigate and either fulfill or place an explicit hold with a reason.
3. Use `format: json` to pipe the digest into a Slack notification or dashboard script.
4. Combine with `order-hold-and-release` to act on exceptions identified in this digest without leaving the CLI.
5. For stores with 500+ open orders, set `limit: 100` and expect pagination — the digest will still aggregate correctly across all pages.
