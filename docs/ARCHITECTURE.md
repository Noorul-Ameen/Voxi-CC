# Architecture

## Design constraints (why it looks like this)

The platform is built around five decoupling rules. The UI never calls VOX directly. The UI never calls ElevenLabs REST APIs directly. Conversation logic lives outside frontend components. Core business logic has no Cloudflare dependency (bindings are injected at the edges). Commerce operations are isolated from discovery and fail closed. These rules are what let future teams swap VOX endpoints, ElevenLabs agents or hosting without rewriting the conversational experience.

## Layer map

```
┌─────────────────────────── Browser (src/) ───────────────────────────┐
│ components/  ChatPanel · DiscoveryPanel · MovieCard · JourneyBar     │
│              FilterBar · DateStrip · ShowtimeList                    │
│ state/store.ts        one Zustand store: ConversationState + chat    │
│ voice/                ElevenLabs service layer (SDK isolated here)   │
│ services/apiClient.ts typed /api client (structured ApiError)        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ /api/* (normalized models only)
┌───────────────────── Cloudflare Worker (worker/) ────────────────────┐
│ api/routes.ts        zod-validated typed endpoints, secure headers   │
│ conversation/        engine.ts (intents→transitions→responses)       │
│                      entities.ts (fuzzy movie/cinema/date/format)    │
│ providers/types.ts   ALL provider interfaces                         │
│ providers/vox/       client (KV cache/timeouts/retries) + parsers +  │
│                      VoxDiscoveryProvider                            │
│ providers/commerce/  FailClosedCommerceProvider (default)            │
│ providers/elevenlabs/ signed voice-session minting                   │
│ providers/registry.ts the ONLY place concrete impls are chosen       │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
        uae.voxcinemas.com · assets.voxcinemas.com · api.elevenlabs.io
        (future: MAF Apigee / Vista Connect partner APIs)
```

`shared/` (models + UAE datetime + fuzzy search) is imported by both sides and is the single definition of every domain type — there are no per-layer copies of Movie/Showtime/ConversationState.

## Conversation architecture

`POST /api/conversation` runs one deterministic turn:

1. **Resolve entities against live catalogs** — movie titles (exact/partial/misspelled/compound via `shared/utils/fuzzy.ts` + prefix/bigram scoring), cinemas (aliases like "MOE" + fuzzy names), Dubai-local date phrases (tonight/tomorrow/weekend/after 7 PM), languages, genres, formats, family-safe, explicit time picks.
2. **Detect intent** (`detectIntent`) — ordered deterministic rules over the taxonomy in `shared/models/conversation.ts` (discover/select/change/ask/commerce/reset…).
3. **Apply transitions** (`applyTransition`) — mutations to a cloned `ConversationState`. Changing an earlier selection preserves still-valid context and clears dependents: cinema change keeps movie+date, clears showtime→tickets→seats→food. Reset keeps the conversation id.
4. **Compose the response** — fetch exactly the data the new state needs (movie-centred showtimes, cinema-day listings, or filtered discovery), build `assistantMessage`, `suggestedActions` and result collections. Commerce intents route to providers and surface fail-closed results honestly.

Natural-language interpretation is used where language is fuzzy; state transitions are code, not prompts. The ElevenLabs agent drives this same engine (see below), so voice cannot fork the journey.

## State management

`src/state/store.ts` holds the server-owned `ConversationState`, the shared chat transcript (text + voice, deduplicated), result collections and per-panel async status (`loading/ready/empty/error` — an empty state can only appear after a completed request). Every UI interaction (card click, selector change, filter toggle, showtime chip, suggested action) is translated into a natural-language message and sent through `sendMessage` → the engine — one write path, so UI, chat and voice always agree. The engine's `updatedConversationState` replaces the local one on every turn.

## ElevenLabs integration

Isolated in `src/voice/` (client) + `worker/providers/elevenlabs/` (session minting). `useVoice` bridges SDK callbacks to the store: transcripts land in the shared history; `sendContextualUpdate` pushes UI state changes to the agent; the agent's `run_conversation_action` client tool calls `sendMessage` — the same engine as typing. Session grants come from `POST /api/voice/session`: signed URL when `ELEVENLABS_API_KEY` is configured, bare public agent id otherwise, 503 fail-closed when neither. The private key never reaches the browser. Details: [ELEVENLABS.md](ELEVENLABS.md).

## VOX integration

Discovery parses VOX UAE's server-rendered pages (stable semantic markup + JSON-LD), preserving Vista cinema codes and session ids exactly. `VoxClient` adds KV caching (5–15 min), 12 s timeouts, bounded retries and a rolling failure log for monitoring. Parsers are tolerant per-block and the client rejects implausible responses (`UPSTREAM_INVALID_RESPONSE`) rather than parse garbage into fake data. Full endpoint catalogue and the future Vista Connect mapping: [VOX_API.md](VOX_API.md).

## Provider architecture

`worker/providers/types.ts` defines `MovieDiscoveryProvider`, `CinemaProvider`, `ShowtimeProvider` and the protected set (`TicketProvider`, `SeatProvider`, `FoodProvider`, `PricingProvider`, `LoyaltyProvider`, `PaymentProvider`, `BookingProvider`, `CancellationProvider`, `RefundProvider`). `registry.ts` wires concrete implementations; today discovery uses `VoxDiscoveryProvider` and every protected capability uses `FailClosedCommerceProvider`. Connecting the official MAF/Vista partner API means implementing one class against the documented interfaces and swapping it in the registry — no frontend, engine or API-shape changes.

## Cloudflare architecture

Single Worker (`worker/index.ts`): Hono serves `/api/*`; static SPA assets come from Workers Assets with SPA fallback; `public/_headers` applies CSP and security headers to asset responses while worker code applies them to API responses. Bindings: `VOX_CACHE` (KV), `ASSETS`; secrets via Cloudflare Secrets. Three environments (dev/staging/production) in `wrangler.jsonc` with separate names, KV namespaces and vars. No always-running Node server anywhere; everything is Workers-compatible (no Node-only APIs in worker/shared code).

## Security boundaries

Secrets exist only server-side (Cloudflare Secrets / `.dev.vars`). All inputs are zod-validated; upstream slugs must match `^[a-z0-9-]+$`. Errors are structured `ApiError`s that never leak internals or upstream bodies. Monitoring detail requires a bearer secret. CSP restricts scripts/connects to self + ElevenLabs, images to self + VOX assets. Logs never include credentials, tokens or customer data.

## Testing architecture

Unit/integration/API suites (Vitest) run against genuine captured VOX pages via an injectable fetcher and clock — deterministic and offline. Playwright drives the real Worker runtime (workerd via the Cloudflare Vite plugin) with the fixture replay server, across desktop/tablet/mobile. `scripts/smoke-test.mjs` validates deployed environments against live VOX, including the fail-closed guarantees.
