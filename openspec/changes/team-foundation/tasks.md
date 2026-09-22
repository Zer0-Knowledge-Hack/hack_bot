# Tasks: Team Foundation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1400-1800 (6 capabilities, schema, crypto, D1, grammY, HTTP, tests) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 scaffold → PR2 domain → PR3 D1/crypto → PR4 Telegram/HTTP+wiring → PR5 docs |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved — stacked-to-main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Scaffold + verify runtime assumptions | PR1 | `npm test` (smoke) | vitest-pool-workers smoke test | delete scaffold files |
| 2 | Domain: entities, access-policy, use cases, ports (fakes only) | PR2 | `npm test -- test/domain` | N/A — pure Vitest | delete `src/domain`, `test/domain` |
| 3 | Crypto + D1 adapters, migrations, isolation tests | PR3 | `npm test -- test/adapters` | vitest-pool-workers D1/WebCrypto | drop `0001_init.sql`, delete `src/adapters/{d1,crypto}` |
| 4 | Telegram/HTTP wiring + composition | PR4 | `npm test -- test/http` | `SELF.fetch` + grammY transformer stub | delete `src/adapters/telegram`, `src/index.ts`, `src/composition.ts` |
| 5 | Key-backup docs + secrets setup | PR5 | N/A (docs) | N/A — no runtime behavior | delete docs file |

## Phase 0: Scaffold & Runtime Verification (PR1)

- [x] 0.1 `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts` with D1 binding `DB` and migrations dir.
- [x] 0.2 RED: smoke test asserting `GET /health` 200 fails (no app yet).
- [x] 0.3 GREEN: minimal `src/index.ts` Hono app with `/health`; smoke passes.
- [x] 0.4 Verify + record: D1 FK enforcement on, `DB.batch()` atomicity, `crypto.subtle.timingSafeEqual` availability, grammY stub under vitest-pool-workers. Note fallbacks (e.g. manual constant-time compare) if any fails.

## Phase 1: Domain Foundation (PR2)

- [x] 1.1 `src/domain/{ids,entities,errors,ports}.ts`: `TeamId` brand, entities, port interfaces.
- [x] 1.2 RED: access-policy tests — self-or-admin edit, last-admin-cannot-be-demoted (spec: Peer edit refused; Admin edits member).
- [x] 1.3 GREEN: `src/domain/access-policy.ts`.
- [x] 1.4 RED: `setup-team`, `join-team` use-case tests with fakes (spec: Successful setup; Setup rejected; getChatMember fails; Caller not admin; New user joins; Already-a-member).
- [x] 1.5 GREEN: implement both use cases.
- [x] 1.6 RED: `change-role`, `update-profile-field`, `bind-data-channel` tests (spec: Admin promotes; Non-admin refused; Single field edit; Rejected edit no audit).
- [x] 1.7 GREEN: implement.
- [x] 1.8 RED: `resolve-dm-team`/`select-dm-team` tests incl. 15-min TTL remember+re-verify and expiry (spec: 0/1/2+ teams; remembered 15 min; expires/membership lost).
- [x] 1.9 GREEN: implement `dm_selections` domain logic against fake repo.
- [x] 1.10 `read-profiles` use case (task-generation gap found in review REL-001): RED/GREEN tests for group in-data-channel read, group outside-data-channel refusal, group no-data-channel-bound refusal, DM registered-member read, cross-team refusal, tenant isolation (spec: member-profiles "Reads Restricted to Data Channel or DM"; design.md:47 lists `read-profiles`).

## Phase 2: Crypto & D1 Adapters (PR3)

- [x] 2.1 `migrations/0001_init.sql` per design schema (teams, members, memberships, profile_fields, audit_log, dm_selections). Verified via `test/adapters/migrations.test.ts` (table list, FK, UNIQUE, CHECK enforcement) applied through `readD1Migrations`/`applyD1Migrations` wired in `vitest.config.ts` + `test/setup/apply-migrations.ts`.
- [x] 2.2 RED (vitest-pool-workers): AES-GCM round trip, AAD mismatch fails, old key version still decrypts (spec: pii-protection versioned key).
- [x] 2.3 GREEN: `src/adapters/crypto/{key-ring,aes-gcm-cipher}.ts`, fail-closed on missing/malformed `PII_KEYRING`. Added `FieldCipher` port (`src/domain/ports.ts`) and `FieldUnreadableError` (`src/domain/errors.ts`) — design-specified but missing from Phase 1 (same task-generation-gap pattern as REL-001).
- [ ] 2.4 RED: D1 repo tests — FK rejection, cross-team isolation on membership/profile/audit reads+writes, `DB.batch()` audit+data atomicity (spec: Cross-tenant read/write impossible).
- [ ] 2.5 GREEN: `src/adapters/d1/*-repo.ts`, all queries scoped by `team_id`.
- [ ] 2.6 RED: raw-row test — full_name/emails/social_links ciphertext, github_username plaintext.
- [ ] 2.7 GREEN: wire cipher into profile/audit upserts.

## Phase 3: Telegram & HTTP Wiring (PR4)

- [ ] 3.1 RED: webhook secret-token tests — valid, missing, mismatched header (spec: telegram-webhook).
- [ ] 3.2 GREEN: `src/index.ts` secret check via `timingSafeEqual` before body parse.
- [ ] 3.3 RED: command routing test — recognized vs ignored update.
- [ ] 3.4 GREEN: `src/adapters/telegram/{bot,commands,context,chat-admin-checker}.ts` (grammY, `BOT_INFO` var).
- [ ] 3.5 RED: DM picker `SELF.fetch` test — forged callback team id refused, valid `sel:<uuid>` re-checks membership.
- [ ] 3.6 GREEN: `src/adapters/telegram/team-picker.ts`.
- [ ] 3.7 RED: `safe-logger` allowlist test — PII fixtures never logged on update-profile-field error path.
- [ ] 3.8 GREEN: `src/adapters/log/safe-logger.ts`; `src/composition.ts` wires env→adapters→use cases per request.
- [ ] 3.9 Data-channel read-gating tests (in-topic vs outside vs DM) + wiring.

## Phase 4: Docs (PR5)

- [ ] 4.1 Write `docs/key-backup.md`: generate `PII_KEYRING` offline, two-custodian password-manager backup, `wrangler secret put` for `BOT_TOKEN`/`WEBHOOK_SECRET`/`PII_KEYRING`, `setWebhook` with `secret_token`, rotation notes.
