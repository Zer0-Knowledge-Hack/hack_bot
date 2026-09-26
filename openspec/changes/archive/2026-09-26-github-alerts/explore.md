## Exploration: GitHub alerts (org webhook alerts + digest via Cloudflare cron)

> Mirror of Engram `sdd/github-alerts/explore` (id 2337). Read-only investigation against `main`.
> Note: the product vision (Engram `product/vision`, `product/roadmap`) later changed the delivery target from the team data channel to per-repo linked forum topics. See `proposal.md`.

### 1. Current architecture / extension points
- Hexagonal Worker. Hono entry `src/index.ts`: single route `POST /telegram/webhook` (checks `X-Telegram-Bot-Api-Secret-Token` via `crypto.subtle.timingSafeEqual`, length-checked first) + `GET /health`. Composition root `src/composition.ts::buildBot(env)` wires D1 repos -> use cases -> grammY bot per request; isolate-cached `FieldCipher` only (no other module state).
- `src/domain/{entities,ports,errors,access-policy,usecases/*}.ts` is framework-free (no grammY/Hono/D1 imports). Every tenant-scoped port method takes `TeamId` first (type-checkable tenancy guard).
- Adapters: `src/adapters/d1/*-repo.ts` (tenant-scoped SQL, one `DB.batch()` per write+audit), `src/adapters/crypto/*` (AES-GCM key ring, AAD = `table|teamId|rowKey|field`), `src/adapters/telegram/{bot,commands,context,team-picker,chat-admin-checker}.ts` (thin grammY edge; `registerCommands(bot, deps)` in commands.ts, each command uses `runCommand` with an explicit `errorReplies` map).
- Schema (`migrations/0001_init.sql`, only migration so far): `teams(id, telegram_chat_id UNIQUE, data_topic_thread_id NULL, created_at)`, `members`, `memberships(UNIQUE(team_id,member_id), UNIQUE(team_id,id))`, `profile_fields` (encrypted except `github_username`, explicitly plaintext "used for integrations in later changes" per pii-protection spec — this change is that integration), `audit_log`, `dm_selections`.
- Team = 1 Telegram supergroup (`teams.telegram_chat_id`). Data channel = a forum topic (`data_topic_thread_id`), bound via admin-only `/datachannel`; alerts/digest should reuse this as delivery target — no new "channel" concept needed.
- `Env` (`src/env.ts`) currently only has `DB, BOT_TOKEN, WEBHOOK_SECRET, PII_KEYRING, BOT_INFO`. No cron trigger configured in `wrangler.jsonc` yet (`triggers.crons` absent), no queues/DOs.
- Test conventions: `test/domain` (pure, fakes), `test/adapters/d1` (vitest-pool-workers + migrations), `test/http` (`SELF.fetch`, e.g. `test/http/webhook-secret.test.ts` pattern for secret/signature tests), `test/runtime-assumptions` for platform behavior checks. Strict TDD, RED first.

### 2. GitHub webhook integration
- **Org webhook (not GitHub App) recommended for MVP.** One webhook configured once at the GitHub org level delivers all repo events to one endpoint; avoids GitHub App complexity (JWT signing, installation tokens, install flow) which has no UI story yet for a solo/no-dashboard bot. Defer GitHub App to a later change if private-repo API polling or self-serve multi-org install is needed.
- **HMAC-SHA256 verification** (`X-Hub-Signature-256: sha256=<hex>`) differs from the Telegram pattern (static token compare): must `crypto.subtle.importKey("raw", secretBytes, {name:"HMAC",hash:"SHA-256"}, false, ["verify"])` then `crypto.subtle.verify` over the **raw body bytes** (verify before `JSON.parse`, mirroring index.ts's "check auth before touching body" order but needs the raw ArrayBuffer, not just a header).
- **Org/repo -> team mapping**: new table, e.g. `github_links(team_id, org_login, repo_full_name NULL /*org-wide*/, created_at)`.
- **Secret storage**: real multi-tenant design wants a secret per team (each team's own org sets its own secret), but building the "create/rotate/reveal-once" UX without a dashboard is nontrivial. MVP recommendation: single global secret via Worker secret (`GITHUB_WEBHOOK_SECRET`), schema still shaped as per-team-capable for a fast follow. Flag as an explicit decision point for `sdd-propose`.
- **First events to support**: `pull_request` (opened, closed/merged) and `issues` (opened, closed) — high value, low noise. Defer `workflow_run`/`check_run`, `release`, `discussion`, `push` (too noisy without filtering).

### 3. Alert configuration model
- D1: `github_alert_rules(team_id, repo_full_name NULL, event_type, enabled, created_at)`.
- Telegram commands (admin-only, same pattern as `/datachannel`'s `UnauthorizedError` reuse): `/githubrepo add|remove <org/repo>`, `/alerts on|off <event>`. Refuse enabling alerts until the team's data channel is bound (mirrors existing `/datachannel` gating).
- Delivery via `bot.api.sendMessage(team.chatId, text, {message_thread_id: team.dataTopicThreadId})` — reuses the pattern already used by `chatAdminChecker` (`bot.api` usable outside the webhook update context).

### 4. Digest
- Needs `wrangler.jsonc` `"triggers": {"crons": [...]}` and an exported `scheduled(event, env, ctx)` handler alongside the Hono `fetch` export (Hono's `app.fetch` doesn't cover `scheduled`; export `{fetch: app.fetch, scheduled}` from `src/index.ts`).
- Aggregate from **stored events**, not live GitHub API queries (avoids GitHub rate limits, keeps one source of truth). Needs a `github_events` table populated by the webhook handler at ingest time.
- True per-team schedule isn't possible with Workers cron (one Worker-wide schedule); MVP = single global cron (e.g. hourly) that checks each team's configured `digest_hour_utc` and only sends when due. Defer arbitrary per-team cron granularity.
- Idempotency: conditional D1 update pattern already used for `changeRole`'s "last admin" guard (`UPDATE ... SET last_digest_at=? WHERE team_id=? AND last_digest_at<?`) to survive duplicate/overlapping cron invocations.

### 5. Risks
- Webhook spoofing if HMAC isn't verified over raw bytes before parsing.
- Telegram rate limits (per-chat ~1 msg/sec, global ~30/sec) — high-volume repos could spam a chat; needs batching/coalescing eventually.
- Telegram 4096-char message cap — digest/alert formatting must truncate.
- D1 growth: a `github_events` table for digest aggregation grows unboundedly, same unresolved retention gap as the existing unbounded `audit_log` — flag for a retention/cleanup follow-up.
- PII: GitHub payloads carry committer emails/real names in commit objects; even though `github_username` is explicitly plaintext-allowed per the PII spec, raw webhook payloads (with commit-author emails) must not be logged verbatim or stored as raw blobs without review — only store/log the fields actually needed (repo, event type, actor login, PR/issue number/title), not the full payload.
- Testing: HTTP signature tests mirror `test/http/webhook-secret.test.ts` (valid/missing/wrong signature, same-length-wrong-signature style cases already established for the Telegram secret). Scheduled-handler tests need vitest-pool-workers `SELF.scheduled()` support — verify before committing to the digest slice.

### 6. MVP recommendation
Ship **alerts before digest** (no cron complexity, faster to prod):
- Slice 1: migration for `github_links` + `github_alert_rules`, domain use cases (pure event->rule matching), `/github/webhook` HTTP route with HMAC verify (single global secret), admin commands `/githubrepo`, `/alerts`, dispatch to data channel. 2 events only (`pull_request`, `issues`).
- Slice 2 (separate PR/possibly separate change): `github_events` table, `scheduled` handler, `wrangler.jsonc` cron config, idempotency guard, single global daily digest time (no per-team schedule yet).
- Defer: GitHub App/install flow, per-team webhook secrets, CI/workflow alerts, release alerts, per-team cron schedule, event coalescing, retention job.

### PR breakdown (400-line review budget each)
1. Migration + domain entities/ports/pure use cases for link+rule config, tests (~250-350 lines).
2. D1 adapters for the two new repos + vitest-pool-workers tests (~200-300 lines).
3. `/github/webhook` route + HMAC WebCrypto verification + composition wiring + signature tests (~200-250 lines).
4. Alert dispatch use case (event -> matching rules -> Telegram send) + wiring + tests (~200-300 lines).
5. Admin commands `/githubrepo`, `/alerts` in `commands.ts` + tests (~150-250 lines).
6. (Digest slice, likely its own change/PR set) `github_events` table, `scheduled` handler, cron config, idempotency tests (~250-350 lines).

**Where**: `src/index.ts`, `src/composition.ts`, `src/domain/{entities,ports,usecases}.ts`, `src/adapters/d1/*`, `src/adapters/telegram/commands.ts`, `migrations/0001_init.sql` (reference only, new migration needed), `wrangler.jsonc`, `openspec/specs/{telegram-webhook,pii-protection}/spec.md`, `openspec/changes/archive/2026-09-23-team-foundation/design.md`.
