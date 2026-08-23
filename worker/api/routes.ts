/** Typed internal API. All external data crosses this boundary as
 *  normalized models; all inputs are schema-validated; all errors are
 *  structured ApiError objects. */

import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiError, ConversationRequest } from '@shared/models';
import { createServices, type AppServices } from '../providers/registry';
import { VoxClient, UpstreamError } from '../providers/vox/client';
import { normalizeState, runConversationTurn } from '../conversation/engine';
import type { WorkerEnv } from '../env';

type Ctx = { Bindings: WorkerEnv; Variables: { services: AppServices } };

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const slugSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);

const moviesQuerySchema = z.object({
  query: z.string().max(200).optional(),
  cinemaId: slugSchema.optional(),
  date: dateSchema,
  language: z.string().max(40).optional(),
  genre: z.string().max(40).optional(),
  rating: z.string().max(10).optional(),
  format: z.enum(['STANDARD', 'MAX', 'IMAX', '4DX', 'GOLD', 'THEATRE', 'KIDS', 'PREMIER', 'PREMIUM', 'OTHER']).optional(),
  familySafe: z.enum(['true', 'false']).optional(),
  timeFrom: z.coerce.number().int().min(0).max(2879).optional(),
  status: z.enum(['now_showing', 'coming_soon']).optional(),
});

const showtimesQuerySchema = z
  .object({
    movieId: slugSchema.optional(),
    cinemaId: slugSchema.optional(),
    date: dateSchema,
  })
  .refine((v) => v.movieId || v.cinemaId, { message: 'movieId or cinemaId is required' });

const conversationSchema = z.object({
  message: z.string().min(1).max(1000),
  conversationId: z.string().max(80).optional(),
  state: z.record(z.string(), z.unknown()).optional(),
  locale: z.string().max(20).optional(),
  timezone: z.string().max(40).optional(),
  channel: z.enum(['text', 'voice']).optional(),
});

function apiError(c: { json: (o: unknown, s?: number) => Response }, err: ApiError, status = 502): Response {
  return c.json({ error: err }, status as 502);
}

function handleUpstream(c: { json: (o: unknown, s?: number) => Response }, err: unknown): Response {
  if (err instanceof UpstreamError) {
    const status =
      err.apiError.code === 'NOT_FOUND' ? 404 :
      err.apiError.code === 'UPSTREAM_TIMEOUT' ? 504 : 502;
    return apiError(c, err.apiError, status);
  }
  // Never leak internals.
  return apiError(c, { code: 'INTERNAL', message: 'Unexpected server error.', retryable: true }, 500);
}

export function createApi(
  serviceFactory: (env: WorkerEnv) => AppServices = createServices,
): Hono<Ctx> {
  const api = new Hono<Ctx>();

  api.use('*', async (c, next) => {
    c.set('services', serviceFactory(c.env));
    await next();
    // Secure headers on API responses.
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Cache-Control', 'no-store');
  });

  /* ── Discovery ── */

  api.get('/cinemas', async (c) => {
    try {
      const cinemas = await c.get('services').vox.listCinemas();
      return c.json({ cinemas });
    } catch (err) {
      return handleUpstream(c, err);
    }
  });

  api.get('/movies', async (c) => {
    const parsed = moviesQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return apiError(c, { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message ?? 'Invalid query', retryable: false }, 400);
    }
    const q = parsed.data;
    try {
      if (q.status === 'coming_soon') {
        const movies = await c.get('services').vox.listMovies('coming_soon');
        return c.json({ movies });
      }
      const results = await c.get('services').vox.discover({
        query: q.query,
        cinemaId: q.cinemaId,
        date: q.date,
        language: q.language,
        genre: q.genre,
        rating: q.rating,
        format: q.format,
        familySafe: q.familySafe === 'true',
        timeFromMinutes: q.timeFrom,
      });
      return c.json({ movies: results });
    } catch (err) {
      return handleUpstream(c, err);
    }
  });

  api.get('/movies/:movieId', async (c) => {
    const id = slugSchema.safeParse(c.req.param('movieId'));
    if (!id.success) return apiError(c, { code: 'BAD_REQUEST', message: 'Invalid movie id', retryable: false }, 400);
    try {
      const services = c.get('services');
      const movie = await services.vox.getMovie(id.data);
      if (!movie) return apiError(c, { code: 'NOT_FOUND', message: 'Movie not found', retryable: false }, 404);
      const availableDates = await services.vox.getAvailableDates(id.data).catch(() => []);
      return c.json({ movie, availableDates });
    } catch (err) {
      return handleUpstream(c, err);
    }
  });

  api.get('/showtimes', async (c) => {
    const parsed = showtimesQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return apiError(c, { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message ?? 'Invalid query', retryable: false }, 400);
    }
    const { movieId, cinemaId } = parsed.data;
        const date = parsed.data.date ?? c.get('services').vox.todayDate();
    try {
      const services = c.get('services');
      let showtimes = movieId
        ? await services.vox.getShowtimesForMovie(movieId, date)
        : await services.vox.getShowtimesForCinema(cinemaId!, date);
      if (movieId && cinemaId) {
        showtimes = showtimes.filter((st) => st.cinemaId === cinemaId);
      }
      return c.json({ showtimes, date });
    } catch (err) {
      return handleUpstream(c, err);
    }
  });

  /* ── Protected commerce (fail-closed) ── */

  api.get('/tickets', async (c) => {
    const cinemaId = c.req.query('cinemaId') ?? '';
    const sessionId = c.req.query('sessionId') ?? '';
    if (!/^\d{1,6}$/.test(cinemaId) || !/^\d{1,10}$/.test(sessionId)) {
      return apiError(c, { code: 'BAD_REQUEST', message: 'cinemaId and sessionId are required', retryable: false }, 400);
    }
    const result = await c.get('services').providers.tickets.getTicketTypes(cinemaId, sessionId);
    if (result.status === 'unavailable') {
      return apiError(c, { code: 'CAPABILITY_UNAVAILABLE', message: result.reason, retryable: false, provider: 'vox-commerce' }, 501);
    }
    if (result.status === 'error') return apiError(c, result.error, 502);
    return c.json({ tickets: result.data, demo: result.status === 'demo' ? result.demoLabel : undefined });
  });

  api.get('/seats', async (c) => {
    const cinemaId = c.req.query('cinemaId') ?? '';
    const sessionId = c.req.query('sessionId') ?? '';
    if (!/^\d{1,6}$/.test(cinemaId) || !/^\d{1,10}$/.test(sessionId)) {
      return apiError(c, { code: 'BAD_REQUEST', message: 'cinemaId and sessionId are required', retryable: false }, 400);
    }
    const result = await c.get('services').providers.seats.getSeatLayout(cinemaId, sessionId);
    if (result.status === 'unavailable') {
      return apiError(c, { code: 'CAPABILITY_UNAVAILABLE', message: result.reason, retryable: false, provider: 'vox-commerce' }, 501);
    }
    if (result.status === 'error') return apiError(c, result.error, 502);
    return c.json({ seatLayout: result.data, demo: result.status === 'demo' ? result.demoLabel : undefined });
  });

  /* Explicit fail-closed transactional endpoints: never fabricate success. */
  for (const [path, capability] of [
    ['/payment', 'payment'],
    ['/booking', 'booking'],
    ['/booking/cancel', 'cancellation'],
    ['/booking/refund', 'refund'],
  ] as const) {
    api.post(path, (c) =>
      apiError(
        c,
        {
          code: 'CAPABILITY_UNAVAILABLE',
          message: `The ${capability} operation requires the official VOX partner API and is fail-closed in this environment.`,
          retryable: false,
          provider: 'vox-commerce',
        },
        501,
      ),
    );
  }

  /* ── Conversation ── */

  api.post('/conversation', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return apiError(c, { code: 'BAD_REQUEST', message: 'Invalid JSON body', retryable: false }, 400);
    }
    const parsed = conversationSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(c, { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message ?? 'Invalid request', retryable: false }, 400);
    }
    const req = parsed.data as ConversationRequest;
    const state = normalizeState({
      ...(req.state as object | undefined),
      conversationId: req.conversationId ?? (req.state as { conversationId?: string } | undefined)?.conversationId,
    });
    try {
      const response = await runConversationTurn({
        message: req.message,
        state,
        services: c.get('services'),
      });
      return c.json(response);
    } catch (err) {
      return handleUpstream(c, err);
    }
  });

  /* ── Voice ── */

  api.post('/voice/session', async (c) => {
    const grant = await c.get('services').voice.createSessionGrant();
    if ('error' in grant) {
      return apiError(c, { code: 'CAPABILITY_UNAVAILABLE', message: grant.error, retryable: true, provider: 'elevenlabs' }, 503);
    }
    return c.json(grant);
  });

  /* ── Health & monitoring ── */

  api.get('/health', (c) =>
    c.json({ status: 'ok', environment: c.env.ENVIRONMENT, time: new Date().toISOString() }),
  );
  api.get('/diagnostics/upstream', async (c) => { if (c.env.ENVIRONMENT === 'production') return apiError(c, { code: 'NOT_FOUND', message: 'Not available', retryable: false }, 404); const UA = 'VoxConversationalCommerce/1.0 (+https://github.com/Noorul-Ameen/Voxi-CC)'; const probes: [string, string, string][] = [['vox-no-ua', 'https://uae.voxcinemas.com/cinemas', ''], ['vox-ua', 'https://uae.voxcinemas.com/cinemas', UA], ['vox-robots', 'https://uae.voxcinemas.com/robots.txt', UA], ['assets-akamai', 'https://assets.voxcinemas.com/robots.txt', UA], ['control-example', 'https://example.com/', UA]]; const results: unknown[] = []; for (const [name, url, ua] of probes) { const t0 = Date.now(); try { const headers: Record<string, string> = { accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' }; if (ua) headers['user-agent'] = ua; const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000), redirect: 'follow' }); const body = await res.text(); results.push({ name, status: res.status, bytes: body.length, ms: Date.now() - t0, server: res.headers.get('server') }); } catch (err) { results.push({ name, error: err instanceof Error ? err.name + ': ' + err.message : 'unknown error', ms: Date.now() - t0 }); } } return c.json({ environment: c.env.ENVIRONMENT, results }); });

  api.get('/monitoring/status', async (c) => {
    const services = c.get('services');
    const [vox, voice] = await Promise.all([
      services.vox.checkHealth(),
      services.voice.checkHealth(),
    ]);
    const commerce = {
      provider: 'vox-commerce',
      health: 'not_configured' as const,
      checkedAt: new Date().toISOString(),
      detail: 'Protected commerce is fail-closed (official VOX partner API not configured).',
    };
    const overall = vox.health === 'ok' ? 'ok' : vox.health === 'degraded' ? 'degraded' : 'unavailable';
    const summary = {
      status: overall,
      environment: c.env.ENVIRONMENT,
      providers: [vox, voice, commerce].map((p) => ({ provider: p.provider, health: p.health })),
    };
    // Detailed view (latency, failure log) requires the monitoring secret.
    const auth = c.req.header('authorization');
    const detailRequested = c.req.query('detail') === '1';
    if (detailRequested) {
      if (!c.env.MONITORING_SECRET || auth !== `Bearer ${c.env.MONITORING_SECRET}`) {
        return apiError(c, { code: 'UNAUTHORIZED', message: 'Monitoring detail requires authorization.', retryable: false }, 401);
      }
      return c.json({
        ...summary,
        providers: [vox, voice, commerce],
        recentUpstreamFailures: VoxClient.getRecentFailures(),
      });
    }
    return c.json(summary);
  });

  api.notFound((c) =>
    apiError(c, { code: 'NOT_FOUND', message: 'Unknown API route', retryable: false }, 404),
  );

  return api;
}
