// Serves the practice site in demo/ at /demo/. Read-only, fixed file types,
// no directory listing, and paths cannot leave the demo folder.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEMO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../demo');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

export async function serveDemo(pathname, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice('/demo/'.length)) || 'index.html';
  } catch {
    return false;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(DEMO_DIR, rel);
  const type = TYPES[path.extname(file)];
  if (!type || !file.startsWith(DEMO_DIR + path.sep)) return false;
  let body;
  try {
    body = await readFile(file);
  } catch {
    return false;
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  res.end(body);
  return true;
}
