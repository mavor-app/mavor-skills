#!/usr/bin/env node
/**
 * One-time / idempotent: align playbook bodies with Mavor connectionId injection.
 * - Remove legacy `store` parameter rows from markdown tables
 * - Fix "Universal (store, ...)" parameter section intros
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findAllBundles } from './lib/bundle-scan.mjs';
import { SKILLS_ROOT } from './lib/paths.mjs';

const STORE_ROW_PATTERNS = [
  /^\| store \| string \| yes \| — \| Store domain \(e\.g\., mystore\.myshopify\.com\) \|\n/gm,
  /^\| store \| string \| yes \| — \| Store domain \|\n/gm,
];

const UNIVERSAL_INTRO =
  /^Universal \(store, format, dry_run\) \+ skill-specific:\n/gm;

const REPLACEMENT_INTRO =
  'User inputs (YAML `input` in frontmatter; workspace connectionId is injected — do not ask for store domain):\n';

const EXECUTION_BULLET =
  '- Call `shopify_graphql_query` with `query` and optional `variables` only; do not use `skill_run` for this playbook.';

async function main() {
  const bundles = await findAllBundles(SKILLS_ROOT);
  let changed = 0;

  for (const b of bundles) {
    const skillPath = join(b.absPath, 'SKILL.md');
    let content = await readFile(skillPath, 'utf-8');
    const original = content;

    for (const re of STORE_ROW_PATTERNS) {
      content = content.replace(re, '');
    }
    content = content.replace(UNIVERSAL_INTRO, REPLACEMENT_INTRO);

    if (
      content.includes('shopify_graphql_query') &&
      !content.includes(EXECUTION_BULLET)
    ) {
      const marker =
        '- Use `shopify_graphql_query` with the GraphQL documents below unless a dedicated Shopify tool applies.\n';
      if (content.includes(marker)) {
        content = content.replace(
          marker,
          `${marker}${EXECUTION_BULLET}\n`,
        );
      }
    }

    if (content !== original) {
      await writeFile(skillPath, content, 'utf-8');
      changed++;
      console.log(`updated: ${b.id}`);
    }
  }

  console.log(`Done. ${changed} of ${bundles.length} bundle(s) updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
