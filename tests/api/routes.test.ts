/** API-layer tests: typed endpoints, validation, structured errors and the
 *  fail-closed guarantees for protected commerce operations. */
import { describe, expect, it } from 'vitest';
import { createApi } from '@worker/api/routes';
import type { WorkerEnv } from '@worker/env';
import { createFixtureServices, type FixtureFetchOptions } from '../helpers/fixtureServices';

const ENV = {
  ENVIRONMENT: 'development',
  MONITORING_SECRET: 'test-secret',
} as unknown as WorkerEnv;

function app(options: FixtureFetchOptions = {}) {
  return createApi(() => createFixtureServices(options));
}

const get = (a: ReturnType<typeof createApi>, path: string, headers?: Record<string, string>) =>
  a.request(path, { headers }, ENV);
const post = (a: ReturnType<typeof createApi>, path: string, body?: unknown) =>
  a.request(
    path,
    { method: 'POST', body: JSON.stringify(body ?? {}), headers: { 'content-type': 'application/json' } },
    ENV,
  );

describe('GET /cinemas', () => {
  it('returns the normalized cinema directory', async () => {
    const res = await get(app(), '/cinemas');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cinemas: { id: string; name: string }[] };
    expect(body.cinemas.length).toBeGreaterThanOrEqual(20);
    expect(body.cinemas.find((c) => c.id === 'mall-of-the-emirates')?.name).toBe('Mall of the Emirates');
  });
  it('maps upstream failure to a structured 502', async () => {
    const res = await get(app({ failAll: true }), '/cinemas');
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; retryable: boolean } };
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
  it('maps timeouts to 504', async () => {
    const res = await get(app({ timeoutAll: true }), '/cinemas');
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UPSTREAM_TIMEOUT');
  });
});

describe('GET /movies', () => {
  it('lists now-showing movies', async () => {
    const res = await get(app(), '/movies');
    const body = (await res.json()) as { movies: unknown[] };
    expect(res.status).toBe(200);
    expect(body.movies.length).toBeGreaterThan(30);
  });
  it('supports fuzzy query search', async () => {
    const res = await get(app(), '/movies?query=spidr%20man');
    const body = (await res.json()) as { movies: { title: string }[] };
    expect(body.movies[0]?.title).toBe('Spider-Man: Brand New Day');
  });
  it('supports familySafe filtering by genuine rating', async () => {
    const res = await get(app(), '/movies?familySafe=true');
    const body = (await res.json()) as { movies: { rating: string }[] };
    expect(body.movies.length).toBeGreaterThan(0);
    for (const m of body.movies) expect(['G', 'PG', 'PG13']).toContain(m.rating);
  });
  it('rejects invalid parameters with 400', async () => {
    const res = await get(app(), '/movies?format=NOT_A_FORMAT');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });
});

describe('GET /movies/:movieId', () => {
  it('returns full detail with available dates', async () => {
    const res = await get(app(), '/movies/spider-man-brand-new-day');
    const body = (await res.json()) as { movie: { runtimeMinutes: number }; availableDates: string[] };
    expect(body.movie.runtimeMinutes).toBe(145);
    expect(body.availableDates.length).toBeGreaterThan(5);
  });
  it('404s for unknown movies without fabricating', async () => {
    const res = await get(app(), '/movies/not-a-real-movie');
    expect(res.status).toBe(404);
  });
  it('rejects malformed ids', async () => {
    const res = await get(app(), '/movies/..%2F..%2Fetc');
    expect(res.status).toBe(400);
  });
});

describe('GET /showtimes', () => {
  it('requires movieId or cinemaId', async () => {
    expect((await get(app(), '/showtimes')).status).toBe(400);
  });
  it('returns genuine sessions for a movie', async () => {
    const res = await get(app(), '/showtimes?movieId=spider-man-brand-new-day');
    const body = (await res.json()) as { showtimes: { id: string }[] };
    expect(body.showtimes.length).toBeGreaterThan(30);
    for (const st of body.showtimes) expect(st.id).toMatch(/^\d+-\d+$/);
  });
  it('returns sessions for a cinema', async () => {
    const res = await get(app(), '/showtimes?cinemaId=mall-of-the-emirates');
    const body = (await res.json()) as { showtimes: { vistaCinemaId: string }[] };
    expect(body.showtimes.length).toBeGreaterThan(20);
    expect(body.showtimes.every((s) => s.vistaCinemaId === '0002')).toBe(true);
  });
});

describe('POST /conversation', () => {
  it('runs a conversation turn', async () => {
    const res = await post(app(), '/conversation', { message: 'I want to watch spiderman' });
    const body = (await res.json()) as {
      detectedIntent: string;
      updatedConversationState: { selectedMovie?: { id: string } };
    };
    expect(res.status).toBe(200);
    expect(body.detectedIntent).toBe('select_movie');
    expect(body.updatedConversationState.selectedMovie?.id).toBe('spider-man-brand-new-day');
  });
  it('validates the payload', async () => {
    expect((await post(app(), '/conversation', { message: '' })).status).toBe(400);
    expect((await post(app(), '/conversation', { nope: true })).status).toBe(400);
  });
});

describe('protected commerce endpoints are fail-closed', () => {
  it('tickets/seats report CAPABILITY_UNAVAILABLE (501), never success', async () => {
    for (const path of ['/tickets?cinemaId=0002&sessionId=624792', '/seats?cinemaId=0002&sessionId=624792']) {
      const res = await get(app(), path);
      expect(res.status).toBe(501);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('CAPABILITY_UNAVAILABLE');
    }
  });
  it('payment/booking/cancel/refund can NEVER report success without genuine upstream', async () => {
    for (const path of ['/payment', '/booking', '/booking/cancel', '/booking/refund']) {
      const res = await post(app(), path, { anything: true });
      expect(res.status).toBe(501);
      const text = await res.text();
      expect(text).not.toMatch(/success|confirmed|reserved|refunded/i);
      expect(text).toMatch(/CAPABILITY_UNAVAILABLE/);
    }
  });
});

describe('voice session endpoint', () => {
  it('fails closed when ElevenLabs is not configured', async () => {
    const res = await post(app(), '/voice/session');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CAPABILITY_UNAVAILABLE');
  });
});

describe('health & monitoring', () => {
  it('health is public', async () => {
    const res = await get(app(), '/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
  it('summary status hides internals', async () => {
    const res = await get(app(), '/monitoring/status');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/latencyMs|recentUpstreamFailures/);
  });
  it('detailed status requires the monitoring secret', async () => {
    expect((await get(app(), '/monitoring/status?detail=1')).status).toBe(401);
    const ok = await get(app(), '/monitoring/status?detail=1', {
      authorization: 'Bearer test-secret',
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { recentUpstreamFailures: unknown[] };
    expect(Array.isArray(body.recentUpstreamFailures)).toBe(true);
  });
});

describe('unknown API routes', () => {
  it('return structured 404', async () => {
    const res = await get(app(), '/definitely-not-a-route');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
