import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'counter.txt');
const PORT = 3001;

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  const prev = existsSync(FILE) ? parseInt(readFileSync(FILE, 'utf8'), 10) || 0 : 0;
  const count = prev + 1;
  writeFileSync(FILE, String(count));
  res.end(JSON.stringify({ count }));
}).listen(PORT, () => console.log(`counter :${PORT}`));
