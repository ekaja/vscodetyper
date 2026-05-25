export interface CodeFile {
  filename: string;
  content: string;
  language: string;
  repo: string;
  branch: string;
  path: string;
}

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript JSX', js: 'JavaScript', jsx: 'JavaScript JSX',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', cpp: 'C++', c: 'C',
  cs: 'C#', rb: 'Ruby', php: 'PHP', swift: 'Swift', kt: 'Kotlin',
  css: 'CSS', scss: 'SCSS', html: 'HTML', json: 'JSON', yaml: 'YAML',
  yml: 'YAML', md: 'Markdown', sh: 'Shell', bash: 'Bash', sql: 'SQL',
  vue: 'Vue', svelte: 'Svelte', ex: 'Elixir', exs: 'Elixir',
  hs: 'Haskell', ml: 'OCaml', clj: 'Clojure', scala: 'Scala',
  r: 'R', dart: 'Dart', lua: 'Lua', zig: 'Zig',
};

const CODE_EXTENSIONS = Object.keys(EXTENSION_TO_LANGUAGE);

const SEARCH_QUERIES = [
  'language:typescript stars:>1000',
  'language:python stars:>2000',
  'language:rust stars:>500',
  'language:go stars:>1000',
  'language:javascript stars:>2000',
  'language:java stars:>1000',
  'language:cpp stars:>500',
  'language:swift stars:>300',
];

function getLanguageFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TO_LANGUAGE[ext] ?? 'Plain Text';
}

function decodeBase64(encoded: string): string {
  try {
    return atob(encoded.replace(/\s/g, ''));
  } catch {
    return '';
  }
}

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });
      if (res.ok) return res;
      if (res.status === 403 || res.status === 429) {
        throw new Error('Rate limited');
      }
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw new Error('Fetch failed');
}

async function getRandomRepo(): Promise<{ owner: string; repo: string; branch: string } | null> {
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  const page = Math.floor(Math.random() * 5) + 1;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=10&page=${page}`;
  try {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    const items = data.items ?? [];
    if (!items.length) return null;
    const repo = items[Math.floor(Math.random() * items.length)];
    return {
      owner: repo.owner.login,
      repo: repo.name,
      branch: repo.default_branch ?? 'main',
    };
  } catch {
    return null;
  }
}

async function getRandomFile(owner: string, repo: string, branch: string, path = ''): Promise<{ name: string; path: string } | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  try {
    const res = await fetchWithRetry(url);
    const items: Array<{ name: string; path: string; type: string; size: number }> = await res.json();
    if (!Array.isArray(items)) return null;

    const files = items.filter(i =>
      i.type === 'file' &&
      i.size > 500 &&
      i.size < 60000 &&
      CODE_EXTENSIONS.some(ext => i.name.endsWith('.' + ext))
    );
    const dirs = items.filter(i =>
      i.type === 'dir' &&
      !i.name.startsWith('.') &&
      !['node_modules', 'vendor', 'dist', 'build', '__pycache__', '.git'].includes(i.name)
    );

    if (files.length > 0 && (dirs.length === 0 || Math.random() < 0.6)) {
      return files[Math.floor(Math.random() * files.length)];
    }
    if (dirs.length > 0) {
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      return getRandomFile(owner, repo, branch, dir.path);
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchRandomCodeFile(): Promise<CodeFile | null> {
  const repoInfo = await getRandomRepo();
  if (!repoInfo) return null;

  const { owner, repo, branch } = repoInfo;
  const file = await getRandomFile(owner, repo, branch);
  if (!file) return null;

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`;
    const res = await fetchWithRetry(url);
    const data = await res.json();
    if (!data.content) return null;

    const raw = decodeBase64(data.content);
    if (!raw || raw.trim().length < 100) return null;

    const lines = raw.split('\n');
    const trimmed = lines
      .filter((_l, i) => i < 500)
      .join('\n');

    return {
      filename: file.name,
      content: trimmed,
      language: getLanguageFromFilename(file.name),
      repo: `${owner}/${repo}`,
      branch,
      path: file.path,
    };
  } catch {
    return null;
  }
}
