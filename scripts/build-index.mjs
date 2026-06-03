#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import { execSync } from 'node:child_process';
import { findAllBundles } from './lib/bundle-scan.mjs';
import { DEFAULT_BASE_URL, DIST_ROOT, REPO_ROOT, SKILLS_ROOT } from './lib/paths.mjs';

function gitRef() {
  try {
    const tag = execSync('git describe --tags --always', {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    }).trim();
    return tag;
  } catch {
    return 'dev';
  }
}

function versionString(gitRefVal) {
  if (/^v\d+\.\d+\.\d+/.test(gitRefVal)) return gitRefVal.replace(/^v/, '');
  const short = gitRefVal.slice(0, 7);
  return `1.0.0+${short}`;
}

async function copyBundleToDist(bundle, distSkillsRoot) {
  for (const f of bundle.files) {
    const src = join(bundle.absPath, f.path);
    const dest = join(distSkillsRoot, bundle.bundleRoot, f.path);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
}

async function main() {
  const bundles = await findAllBundles(SKILLS_ROOT);
  bundles.sort((a, b) => a.id.localeCompare(b.id));

  const ids = new Set();
  for (const b of bundles) {
    if (ids.has(b.id)) {
      console.error(`duplicate global id: ${b.id}`);
      process.exit(1);
    }
    ids.add(b.id);
  }

  const namespaces = [...new Set(bundles.map((b) => b.namespace))].sort();
  const baseUrl = DEFAULT_BASE_URL.endsWith('/')
    ? DEFAULT_BASE_URL
    : `${DEFAULT_BASE_URL}/`;

  const skills = [];
  for (const b of bundles) {
    const raw = await readFile(join(b.absPath, 'SKILL.md'), 'utf-8');
    const { data } = matter(raw);
    const entry = 'SKILL.md';
    const path = `${b.bundleRoot}/${entry}`;

    skills.push({
      id: b.id,
      namespace: b.namespace,
      displayName: data.displayName,
      description: data.description,
      category: data.category,
      tags: data.tags ?? [],
      runtime: data.runtime,
      capabilities: data.capabilities,
      input: data.input ?? {},
      output: data.output ?? {},
      bundleRoot: b.bundleRoot,
      entry,
      path,
      files: b.files,
      contentHash: b.contentHash,
    });

    await copyBundleToDist(b, DIST_ROOT);
  }

  const gitRefVal = gitRef();
  const index = {
    catalogId: 'mavor-skills',
    schemaVersion: 1,
    version: versionString(gitRefVal),
    publishedAt: new Date().toISOString(),
    gitRef: gitRefVal,
    baseUrl,
    skillCount: skills.length,
    namespaces,
    skills,
  };

  await mkdir(DIST_ROOT, { recursive: true });
  await writeFile(
    join(DIST_ROOT, 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf-8',
  );

  console.log(
    `Built dist/: ${skills.length} skills, index.json version=${index.version}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
