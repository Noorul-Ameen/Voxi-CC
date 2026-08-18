/** Cloudflare Worker entry: serves the typed API under /api/* and the SPA
 *  static assets for everything else, with strict security headers. */

import { Hono } from 'hono';
import { createApi } from './api/routes';
import type { WorkerEnv } from './env';

const app = new Hono<{ Bindings: WorkerEnv }>();

app.route('/api', createApi());

// SPA + static assets with security headers.
app.get('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(res.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // ElevenLabs SDK ships its audio worklet inline; wasm for audio processing.
      "script-src 'self' 'wasm-unsafe-eval' blob:",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://assets.voxcinemas.com",
      "media-src 'self' blob:",
      "connect-src 'self' wss://*.elevenlabs.io https://*.elevenlabs.io",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  );
  return new Response(res.body, { status: res.status, headers });
});

export default app;
