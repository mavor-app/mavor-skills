---
name: shopify-referral-source-attribution
displayName: Referral Source Attribution
description: >-
  Read-only: parses each order's landing site and referrer URL to break down
  orders, revenue, and AOV by traffic source — direct, organic, paid, social,
  email, or referral domain.
version: 1.0.0
category: marketing
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
  - marketing
input:
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
  days_back:
    type: number
    required: false
    description: Lookback window in days
  min_orders:
    type: number
    required: false
    description: Minimum orders per source to include in the human-readable summary
  group_by:
    type: string
    required: false
    description: >-
      Grouping level: `category` (direct/organic/paid/social/email/referral),
      `domain` (raw referrer host), or `utm_source` (UTM param value)
  include_utm:
    type: boolean
    required: false
    description: >-
      When true, parse `utm_source`, `utm_medium`, `utm_campaign` from
      `landingPageUrl` query string
---
## Purpose
Aggregates orders by their first-touch traffic source — extracted from each order's `landingPageUrl`, `referrerUrl`, and any UTM parameters embedded in the landing URL. Produces an attribution table showing orders, revenue, and AOV per source so merchants can see which channels are actually converting. Read-only — no mutations. Use when native Shopify analytics dashboards aren't granular enough or when you need to export raw attribution data for an external model.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| format | string | no | human | Output format: `human` or `json` |
| days_back | integer | no | 30 | Lookback window in days |
| min_orders | integer | no | 1 | Minimum orders per source to include in the human-readable summary |
| group_by | string | no | category | Grouping level: `category` (direct/organic/paid/social/email/referral), `domain` (raw referrer host), or `utm_source` (UTM param value) |
| include_utm | bool | no | true | When true, parse `utm_source`, `utm_medium`, `utm_campaign` from `landingPageUrl` query string |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `id`, `name`, `createdAt`, `landingPageUrl`, `referrerUrl`, `customerJourneySummary { firstVisit { landingPage referrerUrl source sourceType utmParameters { source medium campaign term content } } }`, `totalPriceSet`, `customer { numberOfOrders }`, pagination cursor
   **Expected output:** Orders with their landing/referrer/UTM data; paginate until `hasNextPage: false`

2. For each order, derive a normalized source:
   - If `customerJourneySummary.firstVisit.utmParameters.source` is set → use it (strongest signal)
   - Else parse UTM params from `landingPageUrl` query string when `include_utm: true`
   - Else extract host from `referrerUrl` and map to a category:
     - empty/null → `direct`
     - google.com / bing.com / duckduckgo.com → `organic-search`
     - googleads/doubleclick → `paid-search`
     - facebook.com / instagram.com / tiktok.com / x.com / twitter.com / pinterest.com / youtube.com → `social-<host>`
     - mail/gmail/outlook hosts → `email`
     - any other host → `referral-<host>`

3. Aggregate by the chosen `group_by` dimension:
   - orders count
   - revenue = Σ `totalPriceSet.shopMoney.amount`
   - AOV = revenue / orders
   - new-customer % (orders where `customer.numberOfOrders == 1` divided by total in source)

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query OrdersForAttribution($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        createdAt
        landingPageUrl
        referrerUrl
        totalPriceSet {
          shopMoney { amount currencyCode }
        }
        customer {
          id
          numberOfOrders
        }
        customerJourneySummary {
          firstVisit {
            landingPage
            referrerUrl
            source
            sourceType
            utmParameters {
              source
              medium
              campaign
              term
              content
            }
          }
          momentsCount {
            count
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
CSV file `attribution_<YYYY-MM-DD>.csv` with columns:
`order_id`, `order_name`, `created_at`, `source`, `source_category`, `referrer_url`, `landing_page_url`, `utm_source`, `utm_medium`, `utm_campaign`, `revenue`, `is_new_customer`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Null `landingPageUrl` and `referrerUrl` | POS, draft, or import order | Categorize as `unattributed` |
| Malformed UTM params | Unencoded characters in landing URL | Skip UTM parse, fall back to referrer host |
| `customerJourneySummary` not available | Older order or app-created order | Fall back to top-level `landingPageUrl`/`referrerUrl` |

## Best Practices
- Use `group_by: utm_source` when running structured campaigns with consistent UTM tagging — this is the highest-fidelity attribution signal.
- Use `group_by: category` for board-level summaries; merchants want "how much came from social" before "how much came from `instagram.com/p/abc`".
- Cross-reference with `discount-roi-calculator` — combining "which source drives the order" with "which discount the order used" reveals where paid acquisition actually pays off.
- Beware of "direct" inflation — many email-app and social-app clicks lose their referrer and surface as direct. Use UTM tagging on outbound links to recover that signal.
- Run on a multi-month horizon (`days_back: 90`) for low-volume stores so percentage breakdowns aren't dominated by a handful of orders.
