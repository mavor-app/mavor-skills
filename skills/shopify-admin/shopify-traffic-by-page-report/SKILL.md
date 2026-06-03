---
name: shopify-traffic-by-page-report
displayName: Traffic By Page Report
description: >-
  Report sessions, conversion rate, and bounce rate for every product and
  collection page using Shopify's analytics API — surfaces which pages earn
  eyeballs and which convert them.
version: 1.0.0
category: conversion-optimization
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
  - conversion-optimization
input:
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
  dry_run:
    type: boolean
    required: false
    description: Preview operations without executing mutations
  days_back:
    type: number
    required: false
    description: 'Lookback window in days (e.g., `30` = last 30 days)'
  page_type:
    type: string
    required: false
    description: 'Filter to: `products`, `collections`, or `both`'
  top_n:
    type: number
    required: false
    description: Number of pages to show in the ranked output
  sort_by:
    type: string
    required: false
    description: 'Ranking metric: `sessions`, `conversion_rate`, or `bounce_rate`'
---
## Purpose
Queries Shopify's built-in analytics engine (ShopifyQL) to surface session-level traffic data scoped to product and collection pages. Shows which pages are attracting the most traffic, how many sessions convert to orders, and where visitors are bouncing — ready input for SEO prioritisation, merchandising focus, and A/B test targeting. Read-only — no mutations are executed.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| format | string | no | human | Output format: `human` or `json` |
| dry_run | bool | no | false | Preview operations without executing mutations |
| days_back | integer | no | 30 | Lookback window in days (e.g., `30` = last 30 days) |
| page_type | string | no | both | Filter to: `products`, `collections`, or `both` |
| top_n | integer | no | 25 | Number of pages to show in the ranked output |
| sort_by | string | no | sessions | Ranking metric: `sessions`, `conversion_rate`, or `bounce_rate` |

## Workflow Steps

1. **OPERATION:** `shopifyqlQuery` — query (all landing pages)
   **Inputs:** ShopifyQL string `FROM sessions SHOW sessions, conversion_rate GROUP BY landing_page_path SINCE -<days_back>d UNTIL today ORDER BY sessions DESC LIMIT 250`; `sessions` and `conversion_rate` are the confirmed available metrics for this data source
   **Expected output:** All landing pages with session counts and conversion rates; paginate via `OFFSET` if result count equals 250

2. **In-memory filtering:** Filter rows where `landing_page_path` starts with `/products/` (product pages) or `/collections/` (collection pages); apply `page_type` parameter; sort by `sort_by`; truncate to `top_n`; flag pages with sessions above median and `conversion_rate < 0.02` as `high_traffic_low_conversion`

> **Note:** ShopifyQL does not support `LIKE`, `WHERE` string prefix filters, or aggregate aliases that shadow reserved column names (`sessions`, `conversion_rate`). All page-type filtering must be done in-memory after fetching all rows.

## GraphQL Operations

```graphql
# shopifyqlQuery:query (page traffic) — validated against api_version 2025-01
query TrafficByPage($query: String!) {
  shopifyqlQuery(query: $query) {
    parseErrors
    tableData {
      columns {
        name
        dataType
        displayName
      }
      rows
    }
  }
}
```

The `$query` variable (single call — all landing pages, filtered in-memory):
```
FROM sessions
SHOW sessions, conversion_rate
GROUP BY landing_page_path
SINCE -<days_back>d
UNTIL today
ORDER BY sessions DESC
LIMIT 250
```

Then filter rows in-memory:
- Product pages: `landing_page_path.startsWith('/products/')`
- Collection pages: `landing_page_path.startsWith('/collections/')`
- `conversion_rate` is returned as a decimal (e.g. `0.016` = 1.6%) — multiply by 100 for display

> **Confirmed live against 2025-01:** `sessions` (INTEGER) and `conversion_rate` (PERCENT) are the available metrics. `WHERE … LIKE`, `bounce_rate`, `converted_sessions`, and aggregate aliases that shadow reserved names are not supported in ShopifyQL `FROM sessions`.

## Output Format
CSV file `traffic_by_page_<YYYY-MM-DD>.csv` with one row per page:

| Column | Description |
|--------|-------------|
| `page_type` | `product` or `collection` |
| `page_path` | URL path (e.g., `/products/red-sneaker`) |
| `sessions` | Total sessions landing on this page |
| `conversion_rate_pct` | Conversion rate as a percentage (API returns decimal; multiplied by 100) |
| `optimisation_flag` | `high_traffic_low_conversion` if sessions > median and conversion_rate < 2% |

For `format: human`, a ranked table is printed inline truncated to `top_n`, followed by a short list of optimisation candidates flagged with `high_traffic_low_conversion`.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `parseErrors` non-empty | Invalid ShopifyQL syntax — each error is a plain string | Log each string, surface to user; common causes: aliasing a reserved column name (`sessions`, `conversion_rate`), using `LIKE`, or referencing a non-existent column like `converted_sessions` or `bounce_rate` |
| `tableData` is null | No analytics data for the period | Extend `days_back`; confirm the store has traffic |
| `ACCESS_DENIED` / `read_reports` scope missing | Scope not granted at auth time | Re-authenticate adding `read_reports` scope |
| `THROTTLED` | Analytics query rate limit | Wait 2 s, retry up to 3 times |
| No product/collection rows after filtering | Dev/test store or no direct landing traffic to catalog pages | Widen `days_back`; note that most traffic may enter via homepage |

## Best Practices
1. A `conversion_rate_pct` below 1% on a high-traffic product page is worth investigating — check whether the product is out of stock, has poor images, or lacks a clear call-to-action.
2. Collection pages with high bounce rates often signal a poor match between the ad or search term that drove the session and the collection content — review the collection SEO title.
3. Use `page_type: products` after a new product launch to track early traction without noise from collection traffic.
4. Combine with `top-product-performance` to correlate high-converting pages with the products generating the most actual revenue.
5. Re-run the report weekly after making on-page changes (copy, imagery, pricing) to measure the impact — the 7-day window (`days_back: 7`) isolates post-change behaviour cleanly.
