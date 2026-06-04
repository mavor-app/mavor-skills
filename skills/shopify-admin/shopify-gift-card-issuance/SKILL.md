---
name: shopify-gift-card-issuance
displayName: Gift Card Issuance
description: >-
  Issue Shopify gift cards (store credit) to customers as a goodwill gesture,
  post-return incentive, or loyalty reward.
version: 1.0.0
category: conversion-optimization
runtime:
  type: llm
  executor: auto
capabilities:
  tools:
    - shopify_graphql_query
  permissions:
    - shop.product.write
    - shop.read
tags:
  - shopify
  - conversion-optimization
  - mutation
input:
  format:
    type: string
    required: false
    description: 'Output format: `human` or `json`'
  dry_run:
    type: boolean
    required: false
    description: Preview operations without executing mutations
  customer_email:
    type: string
    required: false
    description: Customer email to look up and associate with the gift card
  customer_id:
    type: string
    required: false
    description: Customer GID (alternative to email)
  amount:
    type: number
    required: true
    description: Gift card value in the store's default currency
  reason:
    type: string
    required: false
    description: >-
      Internal note logged on the gift card (e.g., `"Goodwill: delayed shipment
      #1042"`)
  expires_on:
    type: string
    required: false
    description: >-
      Expiry date in ISO 8601 (e.g., `2026-12-31`); if omitted, gift card does
      not expire
  tag_customer:
    type: string
    required: false
    description: 'Optional tag to add to the customer record (e.g., `goodwill-issued`)'
---
## Purpose
Issues Shopify native gift cards to customers programmatically — as goodwill for a delayed shipment, as store credit instead of a cash refund, or as a loyalty reward. Uses Shopify's built-in gift card system; no 3rd-party app required. Gift cards issued here are redeemable at checkout exactly like manual gift cards. Note: `giftCardCreate` is available on all Shopify plans but may require the store to have gift cards enabled in settings.

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
| customer_email | string | yes* | — | Customer email to look up and associate with the gift card |
| customer_id | string | yes* | — | Customer GID (alternative to email) |
| amount | float | yes | — | Gift card value in the store's default currency |
| reason | string | no | — | Internal note logged on the gift card (e.g., `"Goodwill: delayed shipment #1042"`) |
| expires_on | string | no | — | Expiry date in ISO 8601 (e.g., `2026-12-31`); if omitted, gift card does not expire |
| tag_customer | string | no | — | Optional tag to add to the customer record (e.g., `goodwill-issued`) |

*One of `customer_email` or `customer_id` is required.

## Safety

> ⚠️ Step 2 executes `giftCardCreate` which issues real monetary value against your store. Gift cards cannot be deleted once created — they can only be disabled. Run with `dry_run: true` to confirm the customer, amount, and expiry before committing. Verify the amount carefully — issued value is immediately redeemable at checkout.

## Workflow Steps

1. **OPERATION:** `customer` — query
   **Inputs:** Look up by `customer_email` (using customers search) or directly by `customer_id`
   **Expected output:** Customer `id`, `firstName`, `lastName`, `email`; confirm customer exists before issuing

2. **OPERATION:** `giftCardCreate` — mutation
   **Inputs:** `input.initialValue`, `input.customerId`, `input.expiresOn` (optional), `input.note` (reason)
   **Expected output:** `giftCard.id`, `giftCard.code`, `giftCard.balance`, `giftCard.expiresOn`, `userErrors`

## GraphQL Operations

```graphql
# customer:query — validated against api_version 2025-01
query CustomerByEmail($query: String!) {
  customers(first: 1, query: $query) {
    edges {
      node {
        id
        firstName
        lastName
        defaultEmailAddress {
          emailAddress
        }
        tags
      }
    }
  }
}
```

```graphql
# giftCardCreate:mutation — validated against api_version 2025-01
mutation GiftCardCreate($input: GiftCardCreateInput!) {
  giftCardCreate(input: $input) {
    giftCard {
      id
      code
      balance {
        amount
        currencyCode
      }
      expiresOn
      note
      customer {
        id
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

## Output Format
No CSV. The session summary reports the gift card code and amount inline. The support agent copies the code to share with the customer.

```
Gift card issued:
  Customer:  Jane Smith (jane@example.com)
  Code:      ABCD-EFGH-IJKL-MNOP
  Value:     $25.00 USD
  Expires:   2026-12-31 (or "Does not expire")
  Note:      Goodwill: delayed shipment #1042
```

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| Customer not found | Email doesn't match any customer | Verify email; guest checkout customers may not have a customer record |
| `userErrors` from giftCardCreate | Invalid amount (≤ 0) or missing required field | Verify `amount` is a positive number |
| Gift cards not enabled | Store settings don't allow gift cards | Enable in Shopify admin → Settings → Gift cards |
| `write_gift_cards` scope missing | Auth was done without this scope | Re-run reconnect the store connection with required scopes with `write_gift_cards` scope |

## Best Practices
1. Always run `dry_run: true` to confirm customer lookup succeeds and amount is correct before issuing.
2. Always include a `reason` note — it appears in the gift card record and helps your team audit issuances later.
3. Set `tag_customer: goodwill-issued` to track which customers have received goodwill gift cards — combine with `loyalty-segment-export` to monitor their subsequent purchase behavior.
4. Use `expires_on` for promotional gift cards (e.g., holiday campaigns) to create urgency; omit for goodwill issuances so the customer feels the gesture is genuine.
5. For batch issuances (e.g., a service outage affecting 100 customers), loop through a customer list using `format: json` to capture each gift card code for your records.
