import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.FIXTURE_PORT ?? 4321);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Static server for the hazard fixtures.
 *
 * Supports `?delay=<ms>` so async-typeahead and cascade fixtures can exercise
 * the race conditions that are the whole point of those tests.
 */
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  const delay = Number(url.searchParams.get('delay') ?? 0);
  if (delay > 0) await new Promise((r) => setTimeout(r, Math.min(delay, 5000)));

  // Contain path traversal: join, normalize, then verify we are still under
  // ROOT. join() tolerates a leading separator, so no stripping is needed.
  const rel = decodeURIComponent(url.pathname);
  const file = normalize(join(ROOT, rel === '/' ? 'index.html' : rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fixtures on http://127.0.0.1:${PORT}`);
});
