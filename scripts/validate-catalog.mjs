#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { findAllBundles, scanBundleDir } from './lib/bundle-scan.mjs';
import { SKILLS_ROOT } from './lib/paths.mjs';
import { SkillFrontmatterSchema } from './lib/skill-schema.mjs';

const FORBIDDEN_BODY = [
  /shopify auth login/i,
  /shopify store auth/i,
  /\bvia cron\b/i,
];

const ALLOWED_TAG_PREFIXES = new Set(['shopify']);

async function main() {
  const bundles = await findAllBundles(SKILLS_ROOT);
  if (bundles.length === 0) {
    console.error('No skill bundles found under', SKILLS_ROOT);
    process.exit(1);
  }

  const ids = new Set();
  let errors = 0;

  for (const b of bundles) {
    const skillPath = join(b.absPath, 'SKILL.md');
    const raw = await readFile(skillPath, 'utf-8');
    const { data, content } = matter(raw);

    if (ids.has(b.id)) {
      console.error(`duplicate id: ${b.id}`);
      errors++;
    }
    ids.add(b.id);

    if (data.name !== b.id) {
      console.error(
        `${b.id}: frontmatter.name must equal directory id (${data.name})`,
      );
      errors++;
    }

    try {
      SkillFrontmatterSchema.parse(data);
    } catch (e) {
      console.error(`${b.id}: invalid frontmatter`, e.message);
      errors++;
    }

    for (const tag of data.tags ?? []) {
      if (String(tag).includes(':')) {
        console.error(`${b.id}: tag must not contain ':' (upstream operation): ${tag}`);
        errors++;
      }
    }

    const tagSet = new Set(data.tags ?? []);
    if (!tagSet.has('shopify')) {
      console.error(`${b.id}: tags must include 'shopify'`);
      errors++;
    }
    if (data.category && !tagSet.has(data.category)) {
      console.error(`${b.id}: tags must include category '${data.category}'`);
      errors++;
    }

    for (const re of FORBIDDEN_BODY) {
      if (re.test(raw)) {
        console.error(`${b.id}: forbidden body text (${re})`);
        errors++;
      }
    }

    const rescanned = await scanBundleDir(b.absPath, SKILLS_ROOT);
    if (rescanned.files.length !== b.files.length) {
      console.error(`${b.id}: file scan mismatch`);
      errors++;
    }

    if (!content.trim()) {
      console.error(`${b.id}: empty playbook body`);
      errors++;
    }
  }

  console.log(`Validated ${bundles.length} bundles, ${errors} error(s)`);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
