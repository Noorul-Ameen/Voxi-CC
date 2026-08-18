# Environments

Four contexts exist. All share the same code; only bindings, vars and secrets differ.

## Local (developer machine / sandbox)

`npm run dev` boots Vite + the real Workers runtime (workerd) with the **default** environment from `wrangler.jsonc`. Overrides and secrets come from `.dev.vars` (gitignored; template in `.env.example`). KV uses a local simulation automatically. If uae.voxcinemas.com is unreachable, point `VOX_BASE_URL` at the fixture replay server (`node scripts/vox-fixture-server.mjs`) — it serves genuine captured VOX pages and is dev/test-only. Unit/integration/API tests never need network.

## Development (deployed default env)

`npm run deploy` → worker `vox-conversational-commerce`. `ENVIRONMENT=development`, `COMMERCE_MODE=demo` (demo-labelled previews allowed, still never fake success). Intended for ad-hoc engineering verification against live VOX.

## Staging

`npm run deploy:staging` → worker `vox-conversational-commerce-staging`, own KV namespace, `ENVIRONMENT=staging`, `COMMERCE_MODE=demo`. CI deploys staging automatically from `main` after validation, then runs `scripts/smoke-test.mjs` against it. Staging is where release candidates are browser-validated against live VOX before promotion.

## Production

`workflow_dispatch` with `deploy_production=true` (or `npm run deploy:production`) → worker `vox-conversational-commerce-production`. `ENVIRONMENT=production`, `COMMERCE_MODE=production` — **strict fail-closed**: no simulated commerce previews of any kind; protected operations are unavailable unless genuine VOX partner APIs are configured and succeed. Never promote if staging smoke tests fail.

## Configuration matrix

| Setting | Local | Development | Staging | Production |
|---|---|---|---|---|
| Worker name | (local) | vox-conversational-commerce | …-staging | …-production |
| `VOX_BASE_URL` | live or fixture server | live | live | live |
| `COMMERCE_MODE` | demo | demo | demo | **production** |
| `ELEVENLABS_AGENT_ID` | shared agent | shared agent | staging agent when created | production agent when created |
| KV `VOX_CACHE` | local sim | vox_cache_dev\* | vox_cache_staging\* | vox_cache_production\* |
| Secrets | `.dev.vars` | `wrangler secret put` | `wrangler secret put --env staging` | `wrangler secret put --env production` |

\* Placeholder ids in `wrangler.jsonc` — create real namespaces once per environment (`npx wrangler kv namespace create VOX_CACHE [--env …]`) and paste the returned ids.

## Secrets (never committed, never in vars)

`ELEVENLABS_API_KEY`, `MONITORING_SECRET`, and (when MAF grants partner access) `VOX_API_KEY`, `VOX_CLIENT_SECRET`. Set per environment with `wrangler secret put NAME --env <env>`. CI needs repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit + KV:Edit) and `CLOUDFLARE_ACCOUNT_ID`, plus repo variables `STAGING_URL` / `PRODUCTION_URL` for smoke tests.

## Rollback

Cloudflare keeps prior Worker versions: `npx wrangler rollback --env production` (or the dashboard → Workers → Deployments → promote a previous version). Rollback is instant and does not touch KV data. After rolling back, re-run `node scripts/smoke-test.mjs <url>` and revert or fix-forward the offending commit in Git so `main` matches what is deployed.
