# Development Guide (future-team handover)

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. The golden rules: the frontend only speaks to `/api/*` in normalized models; all upstream access goes through provider interfaces; every UI interaction routes through the conversation engine; protected commerce stays fail-closed; nothing customer-facing is ever fabricated.

## How to…

### Add a filter
1. Add the field to `FilterState` (`shared/models/filters.ts`).
2. Teach extraction: `worker/conversation/entities.ts` (recognize the phrase) and/or `worker/api/routes.ts` `moviesQuerySchema` (query param).
3. Apply it in `applyMovieFilters` / `filterShowtimes` (`worker/providers/vox/discovery.ts`).
4. Surface a control in `src/components/FilterBar.tsx` — send a natural-language message (e.g. `Show 3D movies`), never mutate state directly.
5. Add unit tests (entities + filters) and an E2E scenario.

### Add a movie field
1. Extend `Movie` in `shared/models/movie.ts` (one place — both sides import it).
2. Extract it in `worker/providers/vox/parsers.ts` (`parseMovieListPage` / `parseMovieDetail`). If VOX doesn't publish it, leave it `undefined` — do not synthesize.
3. Render it in `src/components/MovieCard.tsx`.
4. Assert it in `tests/unit/parsers.test.ts` against the fixtures.

### Add a VOX endpoint
1. Document it in [VOX_API.md](VOX_API.md) (purpose, URL, method, params, response shape, IDs, errors, limitations).
2. Add a parser in `worker/providers/vox/parsers.ts` (tolerant; empty over invented) + fixture capture under `tests/fixtures/vox/` + parser tests.
3. Expose it via a method on the relevant provider interface in `worker/providers/types.ts` and implement in `VoxDiscoveryProvider` using `VoxClient.getPage` (pick a cache TTL).
4. Wire into routes/engine as needed.

### Change the VOX provider (e.g. adopt the official Vista Connect APIs)
1. Implement the provider interfaces from `worker/providers/types.ts` in a new class (e.g. `worker/providers/vox/vistaConnect.ts`). Remember Vista V1 returns HTTP 200 on failure — check body `Result === 0`.
2. Swap it in `worker/providers/registry.ts` (optionally gated on env config so it activates only when credentials exist).
3. Nothing else changes: frontend, engine and API shapes are provider-agnostic.

### Add a commerce API (tickets, seats, food, payment, booking…)
1. Credentials: add secret names to `.env.example`, `worker/env.ts`, and set them via `wrangler secret put`.
2. Implement the corresponding provider interface (e.g. `TicketProvider`) against the official endpoint ([VOX_API.md](VOX_API.md) has the mapping). Return `CommerceResult`: `ok` ONLY on genuine upstream success; `unavailable`/`error` otherwise. **Never report success the upstream didn't confirm.**
3. Swap into `registry.ts` conditionally on configuration; the fail-closed provider remains the fallback.
4. Extend `handleCommerceIntents` in `worker/conversation/engine.ts` to use real results, and the UI to render them. Anything simulated must be labelled demo and must never appear in `COMMERCE_MODE=production`.
5. Add tests proving both the happy path and that missing credentials still fail closed.

### Add an ElevenLabs tool
- **Client tool** (acts on this user's UI/session): register it on the agent (dashboard or API) and implement the handler in `clientTools` inside `src/voice/useVoice.ts`. Prefer routing through `sendMessage` so state stays unified.
- **Webhook/server tool** (user-independent lookups): add a worker endpoint and register a webhook tool pointing at the deployed URL. Validate inputs like any public endpoint.
- Update [ELEVENLABS.md](ELEVENLABS.md) — the tool list is part of the integration contract.

### Change the ElevenLabs agent id
Edit `ELEVENLABS_AGENT_ID` in `wrangler.jsonc` for the target environment (and `.dev.vars` locally). No code changes. If the new agent is not public, set the `ELEVENLABS_API_KEY` secret so signed-URL mode activates.

### Modify the conversational journey
- New intent: add to `ConversationIntent` (`shared/models/conversation.ts`), detection in `detectIntent`, transition in `applyTransition` (decide what downstream state it invalidates — keep the clearing rules), response in `composeResponse`.
- New journey stage: extend `JourneyStage` + `computeStage`, and the `JourneyBar` chips.
- Keep deterministic logic in the engine; the ElevenLabs prompt should describe behaviour, not implement it.
- Add integration tests in `tests/integration/conversation.test.ts` covering the new turns AND that earlier-selection changes still preserve/clear correctly.

### Deploy staging / production · Roll back
See [ENVIRONMENT.md](ENVIRONMENT.md). Short version: staging = merge to `main` (CI) or `npm run deploy:staging`; production = GitHub Actions "Run workflow" with `deploy_production=true` (or `npm run deploy:production`), only after staging smoke tests pass; rollback = `npx wrangler rollback --env production`, re-run smoke tests, reconcile Git.

## Conventions

Strict TypeScript everywhere (`tsc -b` must be clean); zod at every external boundary; structured `ApiError`s; commit messages follow `feat:/fix:/test:/docs:/refactor:/chore:` with a meaningful summary; every bug fix lands with a regression test; loading/empty/error/retry states are mandatory for any new async UI; never log or commit secrets.

## Test commands

`npm test` (93 unit/integration/API), `npm run test:e2e` (33 browser scenarios; set `PW_CHROMIUM_PATH` if Chromium is preinstalled), `node scripts/smoke-test.mjs <url>` (deployed). CI runs all of them on every push/PR.
