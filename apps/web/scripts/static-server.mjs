import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.argv[2];
const PORT = Number(process.argv[3] || 4599);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  for (const candidate of [file, join(file, 'index.html')]) {
    try {
      const body = await readFile(candidate);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(candidate)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    } catch { /* try next candidate */ }
  }
  // SPA fallback: unknown paths are client-side routes, so serve the app shell.
  try {
    const shell = await readFile(join(ROOT, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    return res.end(shell);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on ${PORT}`));
