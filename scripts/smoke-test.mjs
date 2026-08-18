#!/usr/bin/env node
/**
 * Deployed-environment smoke tests.
 * Usage: node scripts/smoke-test.mjs https://your-deployment.workers.dev
 *
 * Validates: app loads, health endpoint, VOX discovery (genuine data),
 * conversation engine, voice session fail-closed behaviour, protected
 * commerce fail-closed behaviour, monitoring auth.
 * Exits non-zero on any critical failure — CI must not promote a release
 * that fails these.
 */
const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!base) {
  console.error('Usage: node scripts/smoke-test.mjs <deployment-url>');
  process.exit(2);
}

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const fail = (name, detail) => {
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  }
}

const get = async (path, init) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(30_000), ...init });

console.log(`Smoke testing ${base}`);

await check('application loads (SPA shell)', async () => {
  const res = await get('/');
  if (!res.ok) throw new Error(`status ${res.status}`);
  const html = await res.text();
  if (!html.includes('VOX Conversational Commerce')) throw new Error('unexpected HTML');
});

await check('security headers present', async () => {
  const res = await get('/');
  for (const h of ['content-security-policy', 'x-content-type-options', 'x-frame-options']) {
    if (!res.headers.get(h)) throw new Error(`missing ${h}`);
  }
});

await check('GET /api/health', async () => {
  const res = await get('/api/health');
  const body = await res.json();
  if (body.status !== 'ok') throw new Error(JSON.stringify(body));
});

await check('VOX discovery returns genuine movies', async () => {
  const res = await get('/api/movies');
  if (!res.ok) throw new Error(`status ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body.movies) || body.movies.length < 5) {
    throw new Error(`only ${body.movies?.length ?? 0} movies`);
  }
  const bad = body.movies.find((m) => !m.id || !m.title);
  if (bad) throw new Error('movie missing id/title');
});

await check('VOX cinema directory', async () => {
  const res = await get('/api/cinemas');
  const body = await res.json();
  if (!Array.isArray(body.cinemas) || body.cinemas.length < 10) throw new Error('too few cinemas');
});

await check('conversation engine works (text without voice)', async () => {
  const res = await get('/api/conversation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: "What's on tonight?" }),
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const body = await res.json();
  if (!body.assistantMessage || !body.updatedConversationState) throw new Error('malformed response');
});

await check('protected commerce fails closed', async () => {
  const res = await get('/api/payment', { method: 'POST', body: '{}' });
  if (res.status !== 501) throw new Error(`expected 501, got ${res.status}`);
  const text = await res.text();
  if (/success|confirmed/i.test(text)) throw new Error('claims success!');
});

await check('voice session endpoint responds (grant or clean unavailable)', async () => {
  const res = await get('/api/voice/session', { method: 'POST', body: '{}' });
  if (res.status === 200) {
    const body = await res.json();
    if (!body.mode) throw new Error('grant missing mode');
    if (JSON.stringify(body).match(/xi-api-key|sk_/)) throw new Error('leaked secret material');
  } else if (res.status !== 503) {
    throw new Error(`unexpected status ${res.status}`);
  }
});

await check('monitoring summary public, detail protected', async () => {
  const summary = await get('/api/monitoring/status');
  if (!summary.ok) throw new Error(`summary status ${summary.status}`);
  const text = await summary.text();
  if (/recentUpstreamFailures/.test(text)) throw new Error('detail leaked without auth');
  const detail = await get('/api/monitoring/status?detail=1');
  if (detail.status !== 401) throw new Error(`detail should be 401 without token, got ${detail.status}`);
});

console.log(failures === 0 ? '\nAll smoke tests passed.' : `\n${failures} smoke test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
