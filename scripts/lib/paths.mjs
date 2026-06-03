import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = join(__dirname, '../..');
export const SKILLS_ROOT = join(REPO_ROOT, 'skills');
export const DIST_ROOT = join(REPO_ROOT, 'dist');
export const NAMESPACE = 'shopify-admin';

export const DEFAULT_BASE_URL =
  process.env.MAVOR_SKILLS_BASE_URL ??
  'https://mavor-ai.github.io/mavor-skills/';
