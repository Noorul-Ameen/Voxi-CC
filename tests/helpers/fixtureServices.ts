/** Test helper: AppServices wired to genuine captured VOX fixtures.
 *
 * The fixture fetcher replays real pages saved from uae.voxcinemas.com
 * (tests/fixtures/vox/). Unknown paths 404 — tests never fabricate data.
 * Fixture showtime data is anchored to the capture date; tests inject
 * FIXTURE_NOW so "today"/"tomorrow" resolve against it deterministically.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VoxClient } from '@worker/providers/vox/client';
import { VoxDiscoveryProvider } from '@worker/providers/vox/discovery';
import { FailClosedCommerceProvider } from '@worker/providers/commerce/failClosed';
import { ElevenLabsSessionService } from '@worker/providers/elevenlabs/session';
import type { AppServices } from '@worker/providers/registry';
import type { WorkerEnv } from '@worker/env';

/** Capture reference instant: 2026-08-18 14:00 Dubai. */
export const FIXTURE_NOW = new Date('2026-08-18T10:00:00Z');
export const FIXTURE_TODAY = '2026-08-18';
export const FIXTURE_TOMORROW = '2026-08-19';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'vox');

function fixtureFor(url: string): string | undefined {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, '') || '/';
  const dated = u.searchParams.get('d');
  const file = (name: string) => {
    const p = join(fixtureDir, name);
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined;
  };
  if (path === '/movies/whatson') return file('movies-whatson.html');
  if (path === '/movies/comingsoon') return file('movies-comingsoon.html');
  if (path === '/cinemas') return file('cinemas.html');
  const movie = /^\/movies\/([a-z0-9-]+)$/.exec(path);
  if (movie) {
    if (dated) return file(`movie-${movie[1]}-d${dated}.html`);
    return file(`movie-${movie[1]}.html`);
  }
  const cin = /^\/showtimes\/([a-z0-9-]+)$/.exec(path);
  if (cin) return file(`showtimes-${cin[1]}.html`);
  if (path === '/showtimes' && u.searchParams.get('c') === 'mall-of-the-emirates' && dated === '20260819') {
    return file('showtimes-moe-d20260819.html');
  }
  return undefined;
}

export interface FixtureFetchOptions {
  /** Simulate total upstream unavailability. */
  failAll?: boolean;
  /** Simulate timeouts (AbortError). */
  timeoutAll?: boolean;
  /** Return truncated garbage instead of HTML. */
  malformedAll?: boolean;
  /** Count of upstream requests made. */
  counter?: { count: number };
}

export function fixtureFetcher(options: FixtureFetchOptions = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (options.counter) options.counter.count++;
    if (options.timeoutAll) throw new DOMException('The operation timed out.', 'TimeoutError');
    if (options.failAll) return new Response('upstream down', { status: 503 });
    if (options.malformedAll) return new Response('<not html', { status: 200 });
    const body = fixtureFor(url);
    if (!body) return new Response('<html><body>not found</body></html>', { status: 404 });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

export function createFixtureServices(options: FixtureFetchOptions = {}): AppServices {
  const client = new VoxClient({
    baseUrl: 'https://uae.voxcinemas.com',
    fetcher: fixtureFetcher(options),
    retries: 0,
    timeoutMs: 2000,
  });
  const vox = new VoxDiscoveryProvider(client, () => FIXTURE_NOW);
  const commerce = new FailClosedCommerceProvider();
  const voice = new ElevenLabsSessionService({});
  const env = {
    ENVIRONMENT: 'development',
    VOX_BASE_URL: 'https://uae.voxcinemas.com',
    VOX_ASSETS_URL: 'https://assets.voxcinemas.com',
    VOX_PARTNER_API_BASE_URL: '',
    ELEVENLABS_AGENT_ID: '',
    COMMERCE_MODE: 'demo',
  } as unknown as WorkerEnv;
  return {
    env,
    vox,
    voice,
    providers: {
      movies: vox,
      cinemas: vox,
      showtimes: vox,
      tickets: commerce,
      seats: commerce,
      food: commerce,
      pricing: commerce,
      loyalty: commerce,
      payment: commerce,
      booking: commerce,
      cancellation: commerce,
      refund: commerce,
    },
  };
}
