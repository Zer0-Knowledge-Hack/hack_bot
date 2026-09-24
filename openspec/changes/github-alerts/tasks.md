# Tasks: GitHub Alerts Routed to Linked Forum Topics

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1400 (migration, domain, D1, HMAC, HTTP, Telegram, tests) |
| 400-line budget risk | Medium (aggregate); each PR individually Low |
| Chained PRs recommended | Yes |
| Suggested split | PR1 domain → PR2 D1 → PR3 route skeleton → PR4 delivery wiring → PR5 commands |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved — stacked-to-main)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Migration + domain (types, ports, errors, 4 use cases) with fakes | PR1 (~350) | `npm test -- test/domain` | N/A — pure Vitest | delete `src/domain/github.ts`, new usecases, `0002_*.sql` |
| 2 | D1 repos: claims, links, FK/isolation tests | PR2 (~250) | `npm test -- test/adapters/d1` | vitest-pool-workers D1 | delete `src/adapters/d1/{github-org-claim-repo,repo-topic-link-repo}.ts` |
| 3 | `signature.ts` + route skeleton (401/500/ping/malformed JSON) + env binding | PR3 (~250) | `npm test -- test/http/github-webhook.test.ts` | `SELF.fetch` (`webhook-e2e.test.ts` pattern) | delete `/github/webhook` route registration |
| 4 | Mapper, alert sender, `buildGithubRouter`, end-to-end delivery + 500-on-D1-failure tests | PR4 (~300) | `npm test -- test/http` | `SELF.fetch` + `vi.stubGlobal(fetch)` | delete `src/adapters/github/event-mapper.ts`, `src/adapters/telegram/alert-sender.ts` |
| 5 | `/linkrepo`, `/unlinkrepo`, `/repos` commands + tests | PR5 (~250) | `npm test -- test/adapters/telegram/commands.test.ts` | grammY stub, `SELF.fetch` | revert `commands.ts` command registration |

**PR1 actual size (measured `git diff --stat`, intent-to-add, after apply): 871 authored lines (16 files, 0 deletions) — exceeds the 400-line budget and the ~350 estimate above.** Implementation-only lines (migration, `entities.ts`/`errors.ts`/`ports.ts` additions, `github.ts`, 4 use cases, `migrations.test.ts` table-list fix) total ~356, under budget; the overrun comes entirely from the Strict-TDD RED test files (`test/domain/{github,link-repo-to-topic,unlink-repo,list-repo-links,route-github-event}.test.ts`, 451 lines) plus the three new port fakes in `test/fakes/index.ts` (64 lines). All code is written and every test is green (see apply-progress.md). Flagged for the orchestrator/maintainer to decide before this is committed as PR1: accept as `size:exception`, or split into two chained slices (1a: migration + entities/errors/ports + `github.ts` + `link-repo-to-topic`/`unlink-repo`/`list-repo-links` + their tests + fakes; 1b: `route-github-event.ts` + its test). No commit was made.

**PR2 actual size (measured `wc -l`/`git diff --stat`, after apply): production code (`src/adapters/d1/{github-org-claim-repo,repo-topic-link-repo}.ts`) is 112 lines, well under the 400-line budget and the ~250 estimate. Test code (new `test/adapters/d1/{github-org-claim-repo,repo-topic-link-repo}.test.ts` plus 145 added lines in `test/adapters/migrations.test.ts`) totals 466 lines — the size:exception the user pre-accepted for test overrun. No commit was made.

## Phase 1: Domain Foundation (PR1)

- [x] 1.1 RED: `github.ts` — `parseRepoFullName` (lowercase, `owner/repo` shape), `formatGithubAlert` truncation at 4096 (spec: Message Truncated).
- [x] 1.2 GREEN: `src/domain/github.ts` types, `RepoFullName`, `GithubEvent`, `formatGithubAlert`.
- [x] 1.3 Add `RepoTopicLink` entity; `GithubOrgClaimRepo`, `RepoTopicLinkRepo`, `AlertSender` ports; `InvalidRepoError`, `OrgNotClaimedError`, `AlertSendFailedError` in `entities.ts`/`ports.ts`/`errors.ts`.
- [x] 1.4 RED: `link-repo-to-topic` tests — claimed org links, unclaimed org rejected, admin-only, must be inside a topic, re-link moves and reply names old/new topic (spec: repo-topic-links, all "Requirement" scenarios). Note: the "must be inside a topic" and "reply names old/new topic" scenarios are adapter/command-layer concerns (Phase 5, `/linkrepo`); the domain use case tested here covers the claim gate, admin gate, and move-semantics (`previousThreadId`).
- [x] 1.5 GREEN: `src/domain/usecases/link-repo-to-topic.ts`.
- [x] 1.6 RED/GREEN: `unlink-repo.ts`, `list-repo-links.ts` (spec: any member reads, excludes unclaimed-org links).
- [x] 1.7 RED: `route-github-event` — unclaimed org ignored, unlinked repo ignored (no fallback), linked repo delivers, send failure returns `send-failed` kind not thrown (spec: github-alerts Route/Delivery-Failure).
- [x] 1.8 GREEN: `src/domain/usecases/route-github-event.ts`.
- [x] 1.9 `migrations/0002_github_alerts.sql` per design (claims + links, composite FK).

## Phase 2: D1 Adapters (PR2)

- [x] 2.1 RED: migration test — table/FK/UNIQUE/CHECK enforcement, cross-team isolation on links.
- [x] 2.2 GREEN: `src/adapters/d1/github-org-claim-repo.ts`, `repo-topic-link-repo.ts` (upsert `ON CONFLICT DO UPDATE thread_id`).

## Phase 3: Signature and Route Skeleton (PR3)

- [ ] 3.1 RED: HMAC tests — missing header, wrong secret, right-length-wrong-content (timing-safe), valid signature (spec: HMAC Signature Verification, all scenarios).
- [ ] 3.2 GREEN: `src/adapters/github/signature.ts`, WebCrypto HMAC + `timingSafeEqual`, empty/missing secret → `ConfigError` (500), before `JSON.parse`.
- [ ] 3.3 RED: route status tests — `ping` 200, invalid JSON/non-object/unsupported event 200, D1 failure 500 (spec: Ping, Unsupported, Infrastructure Failures).
- [ ] 3.4 GREEN: `src/index.ts` route registration, `env.ts` `GITHUB_WEBHOOK_SECRET`, `.dev.vars.example`, `vitest.config.ts` test binding.

## Phase 4: Delivery Wiring (PR4)

- [ ] 4.1 RED: mapper allowlist test — commit email fixture never appears in mapped `GithubEvent`; `merged` derived from `closed`+`pull_request.merged`; `reviewer` from login/team slug.
- [ ] 4.2 GREEN: `src/adapters/github/event-mapper.ts`.
- [ ] 4.3 RED: `AlertSender` test — `sendMessage` carries `message_thread_id`; send failure surfaces as `AlertSendFailedError`, not thrown to caller.
- [ ] 4.4 GREEN: `src/adapters/telegram/alert-sender.ts` (`new Api(BOT_TOKEN)`, no `Bot`/`PII_KEYRING`).
- [ ] 4.5 GREEN: `composition.ts` `buildGithubRouter(env)` wiring deps end to end.
- [ ] 4.6 RED: e2e — linked repo alert delivered; unlinked/unclaimed silent; send failure logs reason-only and returns 2xx; log output has no payload fixture strings (spec: Delivery Failure, Allowlisted Fields).

## Phase 5: Link Commands (PR5)

- [ ] 5.1 RED: `/linkrepo`/`/unlinkrepo` — admin-only, must be inside a topic (refuse in general chat with instruction), re-link reply names both topics (spec: Admin-Only Link/Unlink, One Topic Per Repo).
- [ ] 5.2 RED: `/repos` — any registered member anywhere in the group, read-only, non-member refused, excludes unclaimed-org links.
- [ ] 5.3 GREEN: wire all three commands in `src/adapters/telegram/commands.ts`.

## Phase 6: Operator Rollout

- [ ] 6.1 (after PR3 merges) `npx wrangler secret put GITHUB_WEBHOOK_SECRET`.
- [ ] 6.2 (after PR4 merges) Configure org webhook: content type `application/json`, same secret, Pull requests + Issues events; verify ping returns 200.
- [x] 6.3 (after PR1 merges, before PR5's `/linkrepo` is used) Claim the org via `wrangler d1 execute` insert into `github_org_claims`.
