#!/usr/bin/env node
/**
 * Local VOX fixture server — DEV/TEST ONLY.
 *
 * Serves genuine VOX UAE pages captured from uae.voxcinemas.com (see
 * tests/fixtures/vox/) so the app and E2E tests can run in sandboxes
 * without egress to VOX. This is test infrastructure: production always
 * talks to the real site. Unknown movie/cinema slugs return 404 — the
 * server never fabricates pages that were not captured.
 *
 * Usage:  node scripts/vox-fixture-server.mjs [port]
 * Then:   echo 'VOX_BASE_URL=http://127.0.0.1:8899' >> .dev.vars
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const port = Number(process.argv[2] ?? 8899);
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'vox');

const read = (name) => {
  const p = join(fixtures, name);
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
};

function resolve(url) {
  const u = new URL(url, 'http://fixture.local');
  const path = u.pathname.replace(/\/+$/, '') || '/';
  const dated = u.searchParams.get('d');

  if (path === '/movies/whatson') return read('movies-whatson.html');
  if (path === '/movies/comingsoon') return read('movies-comingsoon.html');
  if (path === '/cinemas') return read('cinemas.html');

  const movie = /^\/movies\/([a-z0-9-]+)$/.exec(path);
  if (movie) {
    const slug = movie[1];
    if (dated) return read(`movie-${slug}-d20260819.html`) ?? read(`movie-${slug}.html`);
    return read(`movie-${slug}.html`);
  }
  const cinemaShowtimes = /^\/showtimes\/([a-z0-9-]+)$/.exec(path);
  if (cinemaShowtimes) return read(`showtimes-${cinemaShowtimes[1]}.html`);
  if (path === '/showtimes' && u.searchParams.get('c')) {
    const c = u.searchParams.get('c');
    if (c === 'mall-of-the-emirates') return read('showtimes-moe-d20260819.html');
    return read(`showtimes-${c}.html`);
  }
  return undefined;
}

createServer((req, res) => {
  const body = resolve(req.url ?? '/');
  if (!body) {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<html><body>Fixture not captured (dev-only server)</body></html>');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
}).listen(port, '127.0.0.1', () => {
  console.log(`VOX fixture server (dev-only) on http://127.0.0.1:${port}`);
});
