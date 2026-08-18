# VOX Conversational Commerce

Conversational cinema discovery and progressive booking for **VOX Cinemas UAE**. Customers chat or talk (ElevenLabs Conversational AI) to find movies now showing, filter by cinema, date, language, genre, format, rating and family-safety, browse genuine showtimes with real Vista session IDs, and hand off to VOX's official secure booking page. Built as an extensible platform: every upstream capability sits behind a typed provider interface so future teams can connect official VOX commerce APIs without rebuilding the conversational core.

## Technology stack

TypeScript end-to-end. React 19 + Vite 8 SPA, Zustand state, Hono on Cloudflare Workers, Cloudflare KV cache, Zod validation, ElevenLabs Conversational AI (`@elevenlabs/react`), Vitest + Playwright, GitHub Actions CI/CD, Wrangler deployments.

## Architecture summary

```
VOX UAE pages / (future) Vista Connect partner APIs / ElevenLabs
        │
Provider & adapter layer  (worker/providers — typed interfaces, fail-closed commerce)
        │
Normalized application models  (shared/models — the only shapes the app knows)
        │
Conversation engine + state  (worker/conversation — deterministic intents & transitions)
        │
Typed API  (worker/api — /api/movies, /api/conversation, /api/voice/session, …)
        │
UI + voice  (src — chat, cards, selectors; ElevenLabs behind src/voice service layer)
```

One `ConversationState` is the single source of truth. Chat, voice, movie cards, filters and selectors all read from and write through it via the engine — they can never contradict each other. Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Data integrity guarantees

- Movie/cinema/showtime data comes only from genuine VOX UAE sources ([docs/VOX_API.md](docs/VOX_API.md)); Vista cinema codes and session IDs are preserved exactly as published. Nothing is invented — upstream failure produces a structured, retryable error, never plausible-looking data.
- Family-safe mode uses genuine age classifications (G/PG/PG13) — never genre heuristics; unknown rating means excluded.
- Protected commerce (tickets, seats, food, pricing, loyalty, payment, booking, cancellation, refunds) is **fail-closed**: without genuine, authorized VOX partner APIs these operations report `CAPABILITY_UNAVAILABLE` and can never claim success. Booking hand-off uses VOX's official `/booking/{cinemaId}-{sessionId}` deep link.

## Local setup

```bash
npm ci
cp .env.example .dev.vars           # fill in what you have; all optional locally
npm run dev                         # Vite + real Workers runtime (workerd) on :5173
```

If your network cannot reach uae.voxcinemas.com (locked-down sandboxes), replay genuine captured pages instead:

```bash
node scripts/vox-fixture-server.mjs           # serves tests/fixtures/vox on :8899
echo 'VOX_BASE_URL=http://127.0.0.1:8899' >> .dev.vars
```

## ElevenLabs setup

The platform ships wired to the agent **VOXi Concierge — VOX Conversational Commerce** (`ELEVENLABS_AGENT_ID` in `wrangler.jsonc`). The agent is public, so voice works without a server key; set the `ELEVENLABS_API_KEY` secret to switch to signed-URL sessions (recommended for production). Agent prompt, client tool and dynamic variables: [docs/ELEVENLABS.md](docs/ELEVENLABS.md).

## Cloudflare setup & deployment

```bash
npx wrangler kv namespace create VOX_CACHE                 # once per environment
# put the returned ids into wrangler.jsonc (dev/staging/production)
npx wrangler secret put ELEVENLABS_API_KEY --env production
npx wrangler secret put MONITORING_SECRET --env production
npm run deploy:staging
npm run deploy:production
node scripts/smoke-test.mjs https://<deployment-url>       # must pass before promoting
```

CI (GitHub Actions) validates every push, auto-deploys `main` to staging, and deploys production only on explicit dispatch — see `.github/workflows/ci.yml` and [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md).

## Environment variables

See [.env.example](.env.example) for the full annotated list. Secrets (`ELEVENLABS_API_KEY`, `MONITORING_SECRET`, `VOX_API_KEY`, `VOX_CLIENT_SECRET`) live only in Cloudflare Secrets / `.dev.vars` — never in code, bundles or Git.

## Testing

```bash
npx tsc -b            # type validation
npm run lint          # eslint
npm test              # 93 unit/integration/API tests (genuine VOX fixtures)
npm run test:e2e      # 33 Playwright scenarios (desktop/tablet/mobile)
node scripts/smoke-test.mjs <url>   # deployed-environment validation
```

## Monitoring

`GET /api/health` (public liveness) and `GET /api/monitoring/status` (provider summary; add `?detail=1` with `Authorization: Bearer $MONITORING_SECRET` for latency and the recent upstream-failure log).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `UPSTREAM_UNAVAILABLE` for all VOX endpoints | uae.voxcinemas.com unreachable or blocking the egress IP. Check `/api/monitoring/status?detail=1`; retry; consider `VOX_USER_AGENT`. Locally, use the fixture server. |
| Empty movie grid but no error | Genuine empty result for the active filters — that is correct behaviour. |
| Voice button shows "Voice is not configured" | `ELEVENLABS_AGENT_ID` unset in this environment. |
| Voice fails but chat works | By design — voice is an enhancement. Check the agent exists and (if using signed URLs) `ELEVENLABS_API_KEY` is valid. |
| 501 `CAPABILITY_UNAVAILABLE` on tickets/seats/payment | Expected fail-closed behaviour until official VOX partner APIs are configured. |
| Wrong "today" for users abroad | Should not happen — all dates are computed in Asia/Dubai on the server. File a bug if seen. |
| Playwright can't launch a browser | `npx playwright install chromium`, or set `PW_CHROMIUM_PATH` to an existing Chromium binary. |

## Documentation

[ARCHITECTURE](docs/ARCHITECTURE.md) · [VOX_API](docs/VOX_API.md) · [ELEVENLABS](docs/ELEVENLABS.md) · [ENVIRONMENT](docs/ENVIRONMENT.md) · [DEVELOPMENT](docs/DEVELOPMENT.md)
