---
name: shopify-inventory-adjustment
displayName: Inventory Adjustment
description: >-
  Apply inventory quantity adjustments to specific variants at specific
  locations — after a cycle count, 3PL return batch, or sync discrepancy
  correction.
version: 1.0.0
category: merchandising
runtime:
  type: llm
  executor: auto
capabilities:
  tools:
    - shopify_graphql_query
  permissions:
    - shop.inventory.update
    - shop.read
tags:
  - shopify
  - merchandising
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
  adjustments:
    type: string
    required: true
    description: >-
      Array of `{sku, location_id, delta}` objects. `delta` is the signed
      quantity change (e.g., `+5` to add 5 units, `-3` to remove 3)
  reason:
    type: string
    required: false
    description: >-
      Adjustment reason logged to audit trail: `correction`, `cycle_count`,
      `damaged`, `received`, `reservation_created`, `reservation_deleted`,
      `shrinkage`
  reference_document_uri:
    type: string
    required: false
    description: 'URI to link the adjustment to a PO, return, or cycle count document'
---
## Purpose
Applies inventory quantity corrections to specific variants at specific locations — the programmatic equivalent of manually editing inventory in the Shopify admin. Use after a cycle count reveals discrepancies, after a 3PL return batch posts late, or after the `multi-location-inventory-audit` skill identifies Available/Committed drift. Replaces manual row-by-row inventory editing in the Shopify admin.

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
| adjustments | array | yes | — | Array of `{sku, location_id, delta}` objects. `delta` is the signed quantity change (e.g., `+5` to add 5 units, `-3` to remove 3) |
| reason | string | no | `correction` | Adjustment reason logged to audit trail: `correction`, `cycle_count`, `damaged`, `received`, `reservation_created`, `reservation_deleted`, `shrinkage` |
| reference_document_uri | string | no | — | URI to link the adjustment to a PO, return, or cycle count document |

## Safety

> ⚠️ Step 2 executes `inventoryAdjustQuantities` which immediately changes live inventory quantities. Incorrect adjustments can cause overselling (if you reduce too far) or inflated stock counts (if you add incorrectly). Run with `dry_run: true` to see the before/after quantities per SKU before committing. The `reason` field is logged permanently in Shopify's inventory activity history.

## Workflow Steps

1. **OPERATION:** `productVariants` — query
   **Inputs:** For each `{sku}` in `adjustments`: look up the variant by SKU to get its `inventoryItem.id`; also fetch current `inventoryQuantity` for before/after comparison
   **Expected output:** Map of `{sku → inventoryItemId, currentQuantity}` for all adjustment targets; abort if any SKU is not found

2. **OPERATION:** `inventoryAdjustQuantities` — mutation
   **Inputs:** `changes` array of `{inventoryItemId, locationId, delta, ledgerDocumentUri}` using the reason and reference_document_uri parameters
   **Expected output:** `inventoryAdjustmentGroup.changes` with `quantityAfterChange` per item; `userErrors`

## GraphQL Operations

```graphql
# productVariants:query — validated against api_version 2025-01
query VariantBySku($first: Int!, $query: String) {
  productVariants(first: $first, query: $query) {
    edges {
      node {
        id
        sku
        inventoryQuantity
        inventoryItem {
          id
          tracked
        }
        product {
          title
        }
      }
    }
  }
}
```

```graphql
# inventoryAdjustQuantities:mutation — validated against api_version 2025-01
mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
  inventoryAdjustQuantities(input: $input) {
    inventoryAdjustmentGroup {
      id
      reason
      changes {
        name
        delta
        quantityAfterChange
        item {
          id
          sku
        }
        location {
          id
          name
        }
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
CSV file `inventory-adjustments-<YYYY-MM-DD>.csv` with columns: `sku`, `product_title`, `location_name`, `quantity_before`, `delta`, `quantity_after`, `reason`.

## Error Handling
| Error | Cause | Recovery |
|-------|-------|----------|
| SKU not found | SKU doesn't exist in store | Verify SKU spelling; use `low-inventory-restock` to browse valid SKUs |
| `inventoryItem.tracked: false` | Variant has inventory tracking disabled | Enable tracking in Shopify admin before adjusting |
| `userErrors` from mutation | Invalid delta, invalid location, or permission issue | Check `write_inventory` scope and verify location GID |
| Delta would push quantity below 0 | Adjustment removes more than available | Confirm correct delta value; use negative delta only for known stock removals |

## Best Practices
1. Always run `dry_run: true` first — the before/after CSV preview lets you confirm every change before it hits live inventory.
2. Use `reason: cycle_count` with a `reference_document_uri` pointing to your count sheet — this creates a permanent audit trail in Shopify's inventory activity log.
3. Batch all corrections from a single count session into one command rather than applying one-at-a-time — the audit trail groups them under a single `inventoryAdjustmentGroup`.
4. After adjusting, run `multi-location-inventory-audit` again to confirm all discrepancies are resolved.
5. For 3PL return batches, use `reason: received` and link the return batch document URI — this makes reconciliation with your 3PL invoice straightforward.
