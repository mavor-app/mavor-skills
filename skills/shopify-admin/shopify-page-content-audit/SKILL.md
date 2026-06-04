---
name: shopify-page-content-audit
displayName: Page Content Audit
description: >-
  Read-only: lists all pages and blog posts, flags empty or short content and
  missing SEO fields.
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
  min_body_length:
    type: number
    required: false
    description: Flag pages with body content shorter than this (characters)
  include_unpublished:
    type: boolean
    required: false
    description: Also audit unpublished pages and articles
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Scans all store pages and blog articles for missing or thin content (short body, missing SEO title/description, empty body). Thin content pages are penalized by search engines and create a poor customer experience. Read-only — no mutations. Complements `seo-metadata-audit` (which covers products and collections).

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| min_body_length | integer | no | 100 | Flag pages with body content shorter than this (characters) |
| include_unpublished | bool | no | false | Also audit unpublished pages and articles |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `pages` — query
   **Inputs:** `first: 250`, select `title`, `body`, `bodySummary`, `seo`, `publishedAt`, pagination cursor
   **Expected output:** All pages with content and SEO data

2. **OPERATION:** `articles` — query
   **Inputs:** `first: 250`, select `title`, `body`, `seo`, `publishedAt`, `blog { title }`, pagination cursor
   **Expected output:** All blog articles with content data

3. Flag: empty body, body < `min_body_length`, missing SEO title, missing SEO description

## GraphQL Operations

```graphql
# pages:query — validated against api_version 2025-04
query PageContentAudit($after: String) {
  pages(first: 250, after: $after) {
    edges {
      node {
        id
        title
        handle
        publishedAt
        bodySummary
        body
        seoTitle: metafield(namespace: "global", key: "title_tag") { value }
        seoDescription: metafield(namespace: "global", key: "description_tag") { value }
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
# articles:query — validated against api_version 2025-04
query ArticleContentAudit($after: String) {
  articles(first: 250, after: $after) {
    edges {
      node {
        id
        title
        handle
        publishedAt
        body
        summary
        seoTitle: metafield(namespace: "global", key: "title_tag") { value }
        seoDescription: metafield(namespace: "global", key: "description_tag") { value }
        blog {
          id
          title
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
CSV file `content_audit_<YYYY-MM-DD>.csv` with columns:
`type`, `id`, `title`, `handle`, `published_at`, `body_length`, `has_seo_title`, `has_seo_description`, `issue`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| No pages or articles | Minimal store | Exit with 0 results |

## Best Practices
- A page with fewer than 300 words is generally considered "thin content" by search engines — use `min_body_length: 1500` (characters ≈ ~250 words) as a starting threshold.
- The About, FAQ, and Contact pages are high-trust pages that should never be empty — prioritize these.
- Run after any CMS migration or theme change that may have wiped page content.
- Pair with `seo-metadata-audit` for a complete SEO audit covering products, collections, pages, and blog articles in one workflow.
