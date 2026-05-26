import './style.css';
import hljs from 'highlight.js';
import type { CodeFile } from './github';

const CHARS_PER_KEYPRESS = 3;
const MAX_TABS = 8;

interface Tab {
  id: string;
  file: CodeFile;
  charIndex: number;
  element: HTMLElement;
}

const state = {
  tabs: [] as Tab[],
  activeTabId: '',
  pool: [] as CodeFile[],
  usedIndices: new Set<number>(),
  tabCounter: 0,
  isReady: false,
};

// DOM refs
const loadingOverlay = document.getElementById('loading-overlay')!;
const loadingText = document.getElementById('loading-text')!;
const tabsContainer = document.getElementById('tabs-container')!;
const codeContent = document.getElementById('code-content')!;
const lineNumbers = document.getElementById('line-numbers')!;
const codeScrollArea = document.getElementById('code-scroll-area')!;
const statusPosition = document.getElementById('status-position')!;
const statusLanguage = document.getElementById('status-language')!;
const statusBranchName = document.getElementById('status-branch-name')!;
const breadcrumbContent = document.getElementById('breadcrumb-content')!;
const fileTree = document.getElementById('file-tree')!;
const repoFolderName = document.getElementById('repo-folder-name')!;

function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const colors: Record<string, string> = {
    ts: '#3178c6', tsx: '#3178c6', js: '#f0db4f', jsx: '#61dafb',
    py: '#3572a5', rs: '#dea584', go: '#00acd7', java: '#b07219',
    cpp: '#f34b7d', c: '#555555', cs: '#178600', rb: '#701516',
    php: '#4f5d95', swift: '#f05138', kt: '#a97bff', css: '#563d7c',
    scss: '#c6538c', html: '#e34c26', json: '#f0db4f', yaml: '#cb171e',
    yml: '#cb171e', md: '#083fa1', sh: '#89e051', vue: '#41b883',
    svelte: '#ff3e00',
  };
  const color = colors[ext] ?? '#cccccc';
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="flex-shrink:0;">
    <rect x="2" y="1" width="10" height="13" rx="1" fill="${color}" opacity="0.15" stroke="${color}" stroke-width="0.8"/>
    <text x="7" y="10" font-size="5" fill="${color}" text-anchor="middle" font-family="monospace" font-weight="bold">${ext.slice(0,3).toUpperCase()}</text>
  </svg>`;
}

function highlightCode(code: string, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', cpp: 'cpp', c: 'c',
    cs: 'csharp', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
    css: 'css', scss: 'scss', html: 'html', json: 'json', yaml: 'yaml',
    yml: 'yaml', md: 'markdown', sh: 'bash', bash: 'bash', sql: 'sql',
    vue: 'xml', svelte: 'xml',
  };
  const lang = langMap[ext];
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateLineNumbers(text: string) {
  const count = (text.match(/\n/g) ?? []).length + 1;
  const current = lineNumbers.children.length;
  if (current < count) {
    const frag = document.createDocumentFragment();
    for (let i = current + 1; i <= count; i++) {
      const span = document.createElement('span');
      span.textContent = String(i);
      frag.appendChild(span);
    }
    lineNumbers.appendChild(frag);
  } else if (current > count) {
    while (lineNumbers.children.length > count) lineNumbers.lastChild?.remove();
  }
}

function updateStatusBar(tab: Tab) {
  const text = tab.file.content.slice(0, tab.charIndex);
  const lines = text.split('\n');
  const ln = lines.length;
  const col = (lines[lines.length - 1] ?? '').length + 1;
  statusPosition.textContent = `Ln ${ln}, Col ${col}`;
  statusLanguage.textContent = tab.file.language;
  statusBranchName.textContent = tab.file.branch;
}

function updateBreadcrumb(file: CodeFile) {
  const parts = file.path.split('/');
  let html = '';
  parts.forEach((part, i) => {
    if (i > 0) html += `<span class="breadcrumb-sep">›</span>`;
    const isLast = i === parts.length - 1;
    html += `<span class="breadcrumb-item" ${isLast ? 'style="color:#cccccc"' : ''}>${escapeHtml(part)}</span>`;
  });
  breadcrumbContent.innerHTML = html;
}

function updateFileTree(tabs: Tab[], activeId: string) {
  const repoName = tabs[0]?.file.repo.split('/')[1]?.toUpperCase() ?? 'VSCODETYPER';
  repoFolderName.textContent = repoName;
  fileTree.innerHTML = '';
  const frag = document.createDocumentFragment();
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'file-item' + (tab.id === activeId ? ' active' : '');
    el.innerHTML = `${getFileIcon(tab.file.filename)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(tab.file.filename)}</span>`;
    el.addEventListener('click', () => switchTab(tab.id));
    frag.appendChild(el);
  });
  fileTree.appendChild(frag);
}

function renderActiveTab() {
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab) return;
  const visibleText = tab.file.content.slice(0, tab.charIndex);
  codeContent.innerHTML = highlightCode(visibleText, tab.file.filename);
  updateLineNumbers(visibleText);
  updateStatusBar(tab);
  updateBreadcrumb(tab.file);
  codeScrollArea.scrollTop = codeScrollArea.scrollHeight;
  lineNumbers.scrollTop = codeScrollArea.scrollTop;
}

function pickRandomFile(): CodeFile {
  if (state.usedIndices.size >= state.pool.length) state.usedIndices.clear();
  let idx: number;
  do { idx = Math.floor(Math.random() * state.pool.length); }
  while (state.usedIndices.has(idx));
  state.usedIndices.add(idx);
  return state.pool[idx];
}

function createTab(file: CodeFile): Tab {
  state.tabCounter++;
  const id = `tab-${state.tabCounter}`;
  const el = document.createElement('div');
  el.className = 'tab';
  el.dataset.tabId = id;
  el.innerHTML = `
    ${getFileIcon(file.filename)}
    <span class="tab-name" title="${escapeHtml(file.path)}">${escapeHtml(file.filename)}</span>
    <span class="tab-close">×</span>
  `;
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).classList.contains('tab-close')) closeTab(id);
    else switchTab(id);
  });
  tabsContainer.appendChild(el);
  const tab: Tab = { id, file, charIndex: 0, element: el };
  state.tabs.push(tab);
  return tab;
}

function switchTab(id: string) {
  state.tabs.forEach(t => t.element.classList.remove('active'));
  const tab = state.tabs.find(t => t.id === id);
  if (!tab) return;
  tab.element.classList.add('active');
  state.activeTabId = id;
  renderActiveTab();
  updateFileTree(state.tabs, id);
}

function closeTab(id: string) {
  const idx = state.tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  state.tabs[idx].element.remove();
  state.tabs.splice(idx, 1);
  if (state.activeTabId === id) {
    const next = state.tabs[Math.min(idx, state.tabs.length - 1)];
    if (next) switchTab(next.id);
    else {
      state.activeTabId = '';
      codeContent.innerHTML = '';
      lineNumbers.innerHTML = '<span>1</span>';
    }
  }
  updateFileTree(state.tabs, state.activeTabId);
}

function openNextFile() {
  if (state.tabs.length >= MAX_TABS) closeTab(state.tabs[0].id);
  const file = pickRandomFile();
  const tab = createTab(file);
  switchTab(tab.id);
  updateFileTree(state.tabs, tab.id);
}

function handleKeyPress() {
  const tab = state.tabs.find(t => t.id === state.activeTabId);
  if (!tab) return;

  if (tab.charIndex >= tab.file.content.length) {
    openNextFile();
    return;
  }

  tab.charIndex = Math.min(tab.charIndex + CHARS_PER_KEYPRESS, tab.file.content.length);
  renderActiveTab();
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function trackVisit() {
  const el = document.getElementById('visitor-count');
  if (!el) return;
  const count = (parseInt(localStorage.getItem('vscodetyper-visits') ?? '0', 10) || 0) + 1;
  localStorage.setItem('vscodetyper-visits', String(count));
  el.textContent = formatCount(count);
}

async function init() {
  loadingText.textContent = 'Loading code pool...';
  try {
    const res = await fetch('/code-pool.json');
    if (!res.ok) throw new Error('code-pool.json not found');
    const data = await res.json() as { files: CodeFile[]; generatedAt: string };
    state.pool = data.files;
    console.log(`Loaded ${state.pool.length} files (generated: ${data.generatedAt})`);
  } catch (e) {
    loadingText.textContent = 'code-pool.json not found. Run: npm run fetch-code';
    console.error(e);
    return;
  }

  loadingOverlay.classList.add('hidden');
  state.isReady = true;
  openNextFile();
  trackVisit();
}

document.addEventListener('keydown', (e) => {
  if (!state.isReady) return;
  if (e.key === 'F11') {
    e.preventDefault();
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^F\d+$/.test(e.key)) return;
  if (['Tab','Escape','CapsLock','ScrollLock','Pause','Insert',
       'Home','End','PageUp','PageDown','ArrowUp','ArrowDown',
       'ArrowLeft','ArrowRight','PrintScreen','NumLock'].includes(e.key)) return;
  e.preventDefault();
  handleKeyPress();
});

init();
