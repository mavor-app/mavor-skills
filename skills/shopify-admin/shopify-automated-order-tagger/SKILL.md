---
name: shopify-automated-order-tagger
displayName: Automated Order Tagger
description: >-
  Mutation: applies tags to orders based on configurable rules (geography,
  value, product type, risk level, customer tier).
version: 1.0.0
category: order-intelligence
runtime:
  type: llm
  executor: auto
capabilities:
  tools:
    - shopify_graphql_query
  permissions:
    - shop.order.write
    - shop.price.update
    - shop.read
tags:
  - shopify
  - order-intelligence
  - mutation
input:
  rules:
    type: string
    required: true
    description: Array of tagging rules (see Rules Format below)
  days_back:
    type: number
    required: false
    description: Lookback window for orders to tag
  skip_tagged:
    type: boolean
    required: false
    description: Skip orders that already have the target tag
  dry_run:
    type: boolean
    required: false
    description: Preview only — don't apply tags
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
---
## Purpose
Applies tags to orders based on configurable rule sets — geography-based (domestic/international), value-based (high-value, low-value), product-type-based, customer-tier-based, or custom conditions. Supports dry-run mode for safe preview.

## Prerequisites

- A Shopify store connection is selected in Mavor (connectionId is injected by the runtime).
- Do not ask for API keys, tokens, or the `store` domain parameter.
- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.
- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| rules | object[] | yes | — | Array of tagging rules (see Rules Format below) |
| days_back | integer | no | 7 | Lookback window for orders to tag |
| skip_tagged | boolean | no | true | Skip orders that already have the target tag |
| dry_run | boolean | no | true | Preview only — don't apply tags |
| format | string | no | human | Output format: `human` or `json` |

## Rules Format

Each rule has a `condition` and a `tag`:

```json
[
  { "condition": "total_price > 500", "tag": "high-value" },
  { "condition": "total_price < 20", "tag": "low-value" },
  { "condition": "shipping_country != US", "tag": "international" },
  { "condition": "shipping_country = US", "tag": "domestic" },
  { "condition": "line_items_count > 5", "tag": "bulk-order" },
  { "condition": "customer_orders > 3", "tag": "repeat-buyer" },
  { "condition": "customer_orders = 1", "tag": "first-time" },
  { "condition": "risk_level = HIGH", "tag": "needs-review" },
  { "condition": "financial_status = PARTIALLY_REFUNDED", "tag": "partial-refund" },
  { "condition": "fulfillment_status = null", "tag": "unfulfilled" },
  { "condition": "discount_codes contains WELCOME", "tag": "welcome-discount" },
  { "condition": "product_type contains Subscription", "tag": "subscription-order" }
]
```

## Safety

> ⚠️ Mutation skill — always run with `dry_run: true` first to preview tag assignments before applying.

## Workflow Steps

1. **OPERATION:** `orders` — query
   **Inputs:** `query: "created_at:>='<NOW - days_back days>'"`, `first: 250`, select `id`, `name`, `tags`, `totalPriceSet`, `shippingAddress { countryCode }`, `customer { numberOfOrders }`, `displayFinancialStatus`, `displayFulfillmentStatus`, `riskLevel`, `lineItems { product { productType } }`, `discountCodes`, pagination cursor
   **Expected output:** All recent orders with data needed for rule evaluation

2. For each order, evaluate all rules:
   - Parse each condition against order data
   - Collect all matching tags
   - If `skip_tagged: true`, exclude tags already present on the order

3. If `dry_run: true`: report matches without applying
   If `dry_run: false`:

4. **OPERATION:** `orderUpdate` — mutation (for each order needing new tags)
   **Inputs:** `{ id: <order_id>, tags: <existing_tags + new_tags> }`
   **Expected output:** Updated order with new tags
   **Batch:** Process in batches of 10 to respect rate limits

## GraphQL Operations

```graphql
# orders:query — validated against api_version 2025-01
query OrdersForTagging($query: String!, $after: String) {
  orders(first: 250, after: $after, query: $query) {
    edges {
      node {
        id
        name
        tags
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { countryCode provinceCode }
        customer { id numberOfOrders }
        displayFinancialStatus
        displayFulfillmentStatus
        riskLevel
        discountCodes
        lineItems(first: 20) {
          edges {
            node {
              product { productType }
              quantity
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

```graphql
# orderUpdate:mutation — validated against api_version 2025-01
mutation TagOrder($input: OrderInput!) {
  orderUpdate(input: $input) {
    order { id name tags }
    userErrors { field message }
  }
}
```

## Output Format
CSV file `order_tags_<YYYY-MM-DD>.csv` with columns:
`order_id`, `order_name`, `existing_tags`, `new_tags`, `matched_rules`

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| `THROTTLED` | API rate limit exceeded | Wait 2 seconds, retry up to 3 times |
| Invalid rule | Unparseable condition | Skip rule, warn in output |
| `ACCESS_DENIED` | Missing write_orders scope | Switch to read-only mode, report matches only |

## Best Practices
- Always run `dry_run: true` first to preview changes.
- Tags are additive — this skill never removes existing tags.
- Use with `order-risk-report` to auto-tag risk levels.
- Combine with downstream automation tooling for post-tagging actions (e.g., tag "high-value" → assign to VIP fulfillment queue).
- Useful for filtering orders in Shopify admin — tags make complex order segments searchable.
