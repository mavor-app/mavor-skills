---
name: shopify-b2b-company-overview
displayName: B2b Company Overview
description: >-
  Read-only: lists B2B company accounts with locations, catalogs, and payment
  terms for wholesale management.
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
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Queries all B2B company accounts and their associated locations, price lists, and payment terms. Provides a consolidated view of the wholesale account portfolio for ops and sales teams. Read-only — no mutations. Requires Shopify B2B (available on Shopify Plus).

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| store | string | yes | — | Store domain (e.g., mystore.myshopify.com) |
| format | string | no | human | Output format: `human` or `json` |

## Safety

> ℹ️ Read-only skill — no mutations are executed. Safe to run at any time.

## Workflow Steps

1. **OPERATION:** `companies` — query
   **Inputs:** `first: 250`, select `name`, `locations`, `contacts`, `createdAt`, pagination cursor
   **Expected output:** All B2B company accounts; paginate until `hasNextPage: false`

2. **OPERATION:** `companyLocations` — query
   **Inputs:** `first: 250` per company, select `name`, `buyerExperienceConfiguration { paymentTermsTemplate, checkoutToDraft }`, `catalogsCount`
   **Expected output:** Company locations with payment and catalog configuration

## GraphQL Operations

```graphql
# companies:query — validated against api_version 2025-01
query B2BCompanies($after: String) {
  companies(first: 250, after: $after) {
    edges {
      node {
        id
        name
        note
        createdAt
        updatedAt
        locationsCount {
          count
        }
        contactsCount {
          count
        }
        orders(first: 1, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
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
# companyLocations:query — validated against api_version 2025-01
query CompanyLocationsDetail($companyId: ID!) {
  company(id: $companyId) {
    id
    name
    locations(first: 50) {
      edges {
        node {
          id
          name
          shippingAddress {
            countryCode
            city
          }
          buyerExperienceConfiguration {
            paymentTermsTemplate {
              name
              dueInDays
            }
            checkoutToDraft
          }
          catalogsCount {
            count
          }
        }
      }
    }
  }
}
```

## Output Format
CSV file `b2b_companies_<YYYY-MM-DD>.csv` with columns:
`company_id`, `company_name`, `locations_count`, `contacts_count`, `last_order_date`, `last_order_value`, `currency`, `payment_terms`, `has_catalog`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Empty companies list | B2B not configured or no accounts | Exit with 0 companies, note B2B Plus requirement |
| `companies` query not available | Store not on Shopify Plus | Return clear error: B2B requires Shopify Plus |

## Best Practices
- Run monthly as a wholesale account health check — companies with no orders in 90+ days may need outreach.
- `checkoutToDraft: true` means the buyer must have orders approved before payment — useful for understanding which accounts require manual order review.
- For companies with multiple locations but only one catalog, check if the catalog is correctly scoped to each location.
- This skill requires Shopify B2B (Shopify Plus feature) — it will return an empty result or an error on non-Plus stores.
