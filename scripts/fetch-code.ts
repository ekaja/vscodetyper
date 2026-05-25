#!/usr/bin/env node
/**
 * Fetches ~100 random code files from public GitHub repos
 * and writes them to src/code-pool.json
 *
 * Run: npm run fetch-code
 * Requires: GITHUB_TOKEN env var (for 5000 req/hr limit)
 *           falls back to unauthenticated (60 req/hr) if not set
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = join(__dirname, '../public/code-pool.json');

const TARGET_COUNT = 100;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';

const SEARCH_QUERIES = [
  'language:typescript stars:>1000',
  'language:python stars:>2000',
  'language:rust stars:>500',
  'language:go stars:>1000',
  'language:javascript stars:>2000',
  'language:java stars:>1000',
  'language:cpp stars:>500',
  'language:swift stars:>300',
  'language:kotlin stars:>200',
  'language:csharp stars:>500',
];

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript JSX', js: 'JavaScript', jsx: 'JavaScript JSX',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', cpp: 'C++', c: 'C',
  cs: 'C#', rb: 'Ruby', php: 'PHP', swift: 'Swift', kt: 'Kotlin',
  css: 'CSS', scss: 'SCSS', html: 'HTML', json: 'JSON', yaml: 'YAML',
  yml: 'YAML', sh: 'Shell', sql: 'SQL', vue: 'Vue', svelte: 'Svelte',
};

const CODE_EXTENSIONS = Object.keys(EXTENSION_TO_LANGUAGE);
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', '__pycache__', '.git', 'target', '.next', 'coverage']);

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
  if (GITHUB_TOKEN) h['Authorization'] = `token ${GITHUB_TOKEN}`;
  return h;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJSON(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: headers() });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const wait = reset ? (Number(reset) * 1000 - Date.now() + 2000) : 60000;
    console.warn(`  Rate limited. Waiting ${Math.ceil(wait / 1000)}s...`);
    await sleep(Math.min(wait, 120000));
    return fetchJSON(url);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

function decodeBase64(s: string): string {
  return Buffer.from(s.replace(/\s/g, ''), 'base64').toString('utf-8');
}

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TO_LANGUAGE[ext] ?? 'Plain Text';
}

async function getRandomRepo(): Promise<{ owner: string; repo: string; branch: string } | null> {
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  const page = Math.floor(Math.random() * 8) + 1;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=10&page=${page}`;
  try {
    const data = await fetchJSON(url) as { items?: Array<{ owner: { login: string }; name: string; default_branch: string }> };
    const items = data.items ?? [];
    if (!items.length) return null;
    const r = items[Math.floor(Math.random() * items.length)];
    return { owner: r.owner.login, repo: r.name, branch: r.default_branch ?? 'main' };
  } catch (e) {
    console.warn('  getRandomRepo failed:', (e as Error).message);
    return null;
  }
}

async function findCodeFile(owner: string, repo: string, path = '', depth = 0): Promise<{ name: string; path: string } | null> {
  if (depth > 3) return null;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  try {
    const items = await fetchJSON(url) as Array<{ name: string; path: string; type: string; size: number }>;
    if (!Array.isArray(items)) return null;

    const files = items.filter(i =>
      i.type === 'file' &&
      i.size > 500 && i.size < 60000 &&
      CODE_EXTENSIONS.some(ext => i.name.endsWith('.' + ext))
    );
    const dirs = items.filter(i =>
      i.type === 'dir' && !i.name.startsWith('.') && !SKIP_DIRS.has(i.name)
    );

    if (files.length > 0 && (dirs.length === 0 || Math.random() < 0.6)) {
      return files[Math.floor(Math.random() * files.length)];
    }
    if (dirs.length > 0) {
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      return findCodeFile(owner, repo, dir.path, depth + 1);
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchOneFile(): Promise<object | null> {
  const repoInfo = await getRandomRepo();
  if (!repoInfo) return null;

  const { owner, repo, branch } = repoInfo;
  const file = await findCodeFile(owner, repo);
  if (!file) return null;

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`;
    const data = await fetchJSON(url) as { content?: string };
    if (!data.content) return null;

    const raw = decodeBase64(data.content);
    if (!raw || raw.trim().length < 100) return null;

    const content = raw.split('\n').slice(0, 500).join('\n');

    return {
      filename: file.name,
      content,
      language: getLanguage(file.name),
      repo: `${owner}/${repo}`,
      branch,
      path: file.path,
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Fetching ${TARGET_COUNT} code files from GitHub...`);
  if (GITHUB_TOKEN) {
    console.log('Using GITHUB_TOKEN (5000 req/hr)');
  } else {
    console.log('No GITHUB_TOKEN — unauthenticated (60 req/hr). Set GITHUB_TOKEN for better results.');
  }

  const pool: object[] = [];
  let attempts = 0;

  while (pool.length < TARGET_COUNT) {
    attempts++;
    process.stdout.write(`\r  ${pool.length}/${TARGET_COUNT} files (${attempts} attempts)`);

    try {
      const file = await fetchOneFile();
      if (file) pool.push(file);
    } catch (e) {
      console.warn('\n  Error:', (e as Error).message);
    }

    await sleep(200);
  }

  console.log(`\nDone! ${pool.length} files fetched in ${attempts} attempts.`);

  const output = {
    generatedAt: new Date().toISOString(),
    count: pool.length,
    files: pool,
  };

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`Written to ${OUT_FILE}`);
}

main().catch(e => { console.error(e); process.exit(1); });
