# VOX UAE Data Sources

This document catalogues every VOX data source the platform uses or is prepared to use: the public VOX UAE website services used for discovery today, and the official Vista Connect / MAF partner APIs the provider layer is designed to adopt for protected commerce.

## Investigation summary (August 2026)

`https://uae.voxcinemas.com` is a server-rendered site (Akamai-fronted). It exposes **no public JSON API**; all catalogue and showtime data is embedded in stable, semantic HTML (plus schema.org JSON-LD on movie pages). The site's own booking flow hands off to `/booking/{vistaCinemaId}-{vistaSessionId}`, confirming the backing platform is **Vista Cinema (Connect API)** — the same IDs appear in the MAF partner APIs. The platform therefore parses the rendered pages for discovery, preserves every Vista ID exactly as published, and defers transactional operations to the official partner APIs (fail-closed until credentials exist).

Robots policy (`/robots.txt`): clean paths are crawlable; query-string URLs (`*?*`), `/booking/`, `/orders/` and `/account/` are disallowed for crawlers. This application is an interactive user agent (requests are made on behalf of a specific user action, with KV caching keeping upstream volume minimal), not a crawler; date-filtered queries use the same query-string URLs the site's own UI issues. Request volume is bounded by the 5–15 min KV cache and the top-8 expansion cap in `discover()`. Never bypass authentication, anti-bot challenges or access controls; if VOX blocks server-side fetching, surface `UPSTREAM_UNAVAILABLE` honestly.

## Dependency flow

```
/cinemas ──────────────► cinema slugs + names + addresses
/movies/whatson ───────► movie slugs, titles, ratings, languages, posters (Vista film id)
/movies/comingsoon ────► same shape, status=coming_soon
/movies/{slug} ────────► JSON-LD metadata + date nav + TODAY's sessions per cinema/format
/movies/{slug}?d=YYYYMMDD ─► that date's sessions        │ preserves {cinemaId}-{sessionId}
/showtimes/{cinema-slug} ──► cinema's TODAY sessions      │
/showtimes?c={slug}&d= ────► cinema's dated sessions      ▼
                     https://uae.voxcinemas.com/booking/{cinemaId}-{sessionId}
                     (official VOX checkout — the progressive-booking hand-off)
```

IDs preserved end-to-end: movie slug (e.g. `spider-man-brand-new-day`), Vista film id from asset URLs (`HO00013065`), Vista cinema code (`0002` = Mall of the Emirates), Vista session id (`624792`). The composite `Showtime.id` is `{cinemaCode}-{sessionId}` exactly as VOX publishes it. **No client-generated IDs are ever substituted.**

## Endpoint catalogue (public site — discovery, no authentication)

### GET /movies/whatson · GET /movies/comingsoon
Purpose: full now-showing / coming-soon catalogue. Response: HTML with `article.movie-summary` cards → `data-slug`, `data-title`, `span.classification` (G/PG/PG13/PG15/15+/18+/TBC), `Language:` field, poster `https://assets.voxcinemas.com/posters/P_{vistaFilmId}_{ts}.jpg`. Parser: `parseMovieListPage`. Cache 15 min. Errors: non-200/short body → `UPSTREAM_UNAVAILABLE` / `UPSTREAM_INVALID_RESPONSE`. Limitations: no synopsis/genre/runtime (movie page has those); sort/filter params (`?o=`, `?c=`) exist but are not needed (we filter after parse).

### GET /movies/{slug} · GET /movies/{slug}?d=YYYYMMDD
Purpose: movie metadata + that date's sessions across all cinemas (default: today, Dubai time). Response: JSON-LD `Movie` (name, genre, description, inLanguage, contentRating, duration PT{n}M, image, actors) + `nav.date-filter` (available dates, ~8 days) + `#showtimes` section: `h3.highlight` (cinema name) → `strong` (format label: MAX, IMAX, Kids, GOLD, 4DX, THEATRE, Premier, Premium, Standard, "THEATRE PODS in IMAX"…) → `li[data-id="{cinemaId}-{sessionId}"]` with display time (`11:30pm`). Parsers: `parseMovieDetail`, `parseAvailableDates`, `parseMoviePageShowtimes`. Cache 5 min. 404 for unknown slug → `NOT_FOUND` (never fabricated).

### GET /cinemas
Purpose: cinema directory (~24 UAE locations). Response: `article.cinema-summary` → `data-slug`, name, address. Cinema detail pages (`/cinemas/{slug}`) additionally list experiences (IMAX/THEATRE/KIDS/4DX…). Parser: `parseCinemasPage`. Cache 15 min. Limitation: Vista cinema codes are not on this page — they come from session `data-id`s and are joined by cinema name.

### GET /showtimes/{cinema-slug} · GET /showtimes?c={slug}&d=YYYYMMDD
Purpose: one cinema's full day across all movies (efficient cinema-first discovery — one upstream fetch). Response: `article.movie-compare` blocks → hero image (`B_{vistaFilmId}`), `h2` title, classification, language + runtime tags, then the same showtimes structure. Parser: `parseCinemaShowtimesPage`. Cache 5 min.

### Static assets (assets.voxcinemas.com)
Posters `P_{vistaFilmId}_{ts}.jpg` (portrait), heroes `B_{vistaFilmId}_{ts}.jpg` (landscape). Referenced directly by the UI (CSP-allowed); the Vista film id is extracted for future Connect API joins.

## Official partner APIs (protected commerce — NOT yet connected)

Everything below requires MAF-issued credentials and IP whitelisting. Until then the corresponding providers are **fail-closed** (`CAPABILITY_UNAVAILABLE`); none of it is approved for production use from this codebase today.

Base URLs: dev `https://api-dev.maflec.com/vistatickets/vista/v2/`, prod `https://api-prod.maflec.com/vistatickets/vista/v2/`.
Auth: `GET /v1/oauth/generate?grant_type=client_credentials` with `Authorization: Basic base64(apikey:secret)` → Bearer token; then `Authorization: Bearer {token}` + `x-api-key: {apikey}` on every call. Secrets map to `VOX_API_KEY` / `VOX_CLIENT_SECRET` / `VOX_PARTNER_API_BASE_URL`.

| Capability (provider interface) | Endpoint | Notes |
|---|---|---|
| Reference data | `/OData/Cinemas?$format=json&$filter=CurrencyCode eq 'AED'` · `/OData/Films` · `/OData/ScheduledFilms?$filter=CinemaId eq '{id}'` · `/OData/Sessions?$filter=CinemaId eq '{id}'&$expand=Attributes` | OData 2.0; `ScheduledFilm` preferred for availability. Vista **V1 returns HTTP 200 even on failure — check body `Result: 0`**. |
| TicketProvider | `/Data/Cinemas/{cinemaId}/sessions/{sessionId}/tickets?salesChannel=WWW` | Ticket types + prices (values in cents). |
| SeatProvider | `/Data/Cinemas/{cinemaId}/sessions/{sessionId}/seat-plan` | Real-time layout + availability; excluded from batch APIs. |
| FoodProvider | `/Data/concession-items-grouped-by-tabs?cinemaId={id}&userSessionId={id}` | `UserSessionId` is the one legitimate client-generated id (cart linkage), per Vista spec. |
| Order lifecycle (Pricing/Payment/Booking) | `/Ticketing/Order/tickets` → `/Ticketing/Order/seats` → `/Ticketing/Order/concessions` → `/Ticketing/order` → `/Ticketing/order/payment` (→ booking reference) · `/Ticketing/order/cancel` | Cart bound to UserSessionId; auto-expires. |
| BookingProvider (history) | Apigee `loyaltyalternate/v1/bookingsearch`; member validate `RESTLoyalty.svc/member/validate` | Requires customer auth. |
| Cancellation/RefundProvider | `RESTBooking.svc/booking/refund`; CPI wrappers `vistaTransaction`, `vistaCancellation` | Refund permission is per client token (403 = not permitted). |

Additional integration cautions: reCAPTCHA may be enabled per endpoint (agent clients need it disabled for their key); sensitive endpoints are rate-limited; prefer `*Offset` date fields; monetary values are integer cents.

## Data integrity rules (enforced in code)

`worker/providers/vox/parsers.ts` skips unparseable blocks and returns empty rather than guessing; `VoxClient` rejects implausible bodies; the engine converts upstream failures into structured retryable errors with selections preserved. Tests in `tests/api` and `tests/integration` assert that no commerce endpoint can report success while upstream is unavailable, and that empty results are genuine empties, not error masking.
