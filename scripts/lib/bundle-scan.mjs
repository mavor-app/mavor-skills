import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const IGNORED = new Set(['.DS_Store']);

function kindForRelPath(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  if (norm === 'SKILL.md') return 'playbook';
  if (norm.startsWith('scripts/')) return 'script';
  if (norm.startsWith('references/')) return 'reference';
  return 'asset';
}

function mediaTypeForPath(relPath) {
  if (relPath.endsWith('.md')) return 'text/markdown';
  if (relPath.endsWith('.mjs') || relPath.endsWith('.js'))
    return 'application/javascript';
  if (relPath.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

async function walkFiles(dir, baseDir, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(full, baseDir, out);
    } else if (entry.isFile()) {
      const rel = relative(baseDir, full).replace(/\\/g, '/');
      const buf = await readFile(full);
      const sha256 = createHash('sha256').update(buf).digest('hex');
      out.push({
        path: rel,
        kind: kindForRelPath(rel),
        mediaType: mediaTypeForPath(rel),
        sha256,
      });
    }
  }
}

export function bundleContentHash(files) {
  const payload = files
    .map((f) => `${f.path}:${f.sha256}`)
    .sort()
    .join('\n');
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

export async function scanBundleDir(absBundleDir, skillsRoot) {
  const skillMd = join(absBundleDir, 'SKILL.md');
  try {
    const s = await stat(skillMd);
    if (!s.isFile()) return null;
  } catch {
    return null;
  }

  const bundleRoot = relative(skillsRoot, absBundleDir).replace(/\\/g, '/');
  const parts = bundleRoot.split('/');
  if (parts.length < 2) return null;

  const namespace = parts[0];
  const id = parts.slice(1).join('/');
  const files = [];
  await walkFiles(absBundleDir, absBundleDir, files);
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    bundleRoot,
    namespace,
    id,
    files,
    contentHash: bundleContentHash(files),
  };
}

export async function findAllBundles(skillsRoot) {
  const results = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const bundle = await scanBundleDir(dir, skillsRoot);
    if (bundle) {
      results.push({ absPath: dir, ...bundle });
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name));
      }
    }
  }

  await walk(skillsRoot);
  return results;
}
