# Apply Progress: hackathon-participation

Completed so far: Phase 1 (1.1-1.12), Phase 2 (2.1-2.11) and Phase 3 (3.1-3.10). Phase 4 (operator steps and final verification) pending.

## Batch 1 — Phase 1 Infrastructure (PR1a) — branch `feat/participation-infra`

Mode: Strict TDD. Delivery: stacked-to-main, PR1a (infrastructure unused until PR1b).

Completed: 1.1–1.12 (12/12 of Phase 1). Phases 2–4 pending.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1/1.2 | `test/adapters/migrations.test.ts` | Integration (D1) | 20/20 | 3 failed (no such column) | 23/23 | 3 cases (nullable id, NOT NULL DEFAULT 0, defaults on insert) | None needed |
| 1.3/1.4/1.5 | `test/adapters/d1/hackathon-analysis-repo.test.ts` | Integration (D1) | 13/13 | 13 failed (missing methods/field) | 26/26 | null/stale/mismatch, TTL boundary, race, tenant scope, release, save + persistAnalysis non-clobber | Test ids made per-team (id is the upsert key) |
| 1.6/1.7/1.8 | `test/adapters/telegram/forum-topic-manager.test.ts` | Unit (Api stub) | N/A (new) | module missing | 25/25 | 10 create classes + network/timeout/abort signal; 4 deleted strings, 5 ambiguous incl. non-400 with deleted text, network | None needed |
| 1.9/1.10 | `test/adapters/telegram/chat-publisher.test.ts` | Unit (Api stub) | 21/21 | 5 failed | 26/26 | no-option, empty options, button, 40-char slug ≤64 B, clear ok/400/502 | None needed |
| 1.11 | `test/fakes/index.ts` | Test support | n/a | exercised by PR1b tests | typecheck green | ➖ Triangulation skipped: fakes | ➖ |
| 1.12 | full suite | — | — | — | 916/916, typecheck clean | — | — |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and result | `npx vitest run test/adapters` files above: all green (migrations 23, repo 26, topic manager 25, publisher 26) |
| Runtime harness | N/A: infrastructure unused until PR1b; no fetch/LLM path |
| Rollback boundary | new files + additive columns (ignored on revert); `HackathonAnalysis.generalMessageId` and `ChatPublisher` additions |

### Commits
- `2a2d4c1` docs: exploration, proposal, specs, design, tasks
- `9f2c910` feat(db): migration 0004
- `142b2d7` feat(d1): claim CAS, release, general message id
- `7f7860f` feat(telegram): ForumTopicManager port and adapter
- `27b496a` feat(telegram): clearButtons and participation button

### Deviations / notes
- `HackathonAnalysis.generalMessageId` is a required field, so 12 existing test fixtures gained `generalMessageId: null` (mechanical) and `analyzeHackathon` carries `existing?.generalMessageId ?? null` (SQL upsert never writes it).
- `PARTICIPATE_CALLBACK_PREFIX = "hp:"` is exported from `chat-publisher.ts` so the PR2 handler reuses it.
- Claim uses `topic_claim_until <= now` (an expired-at-now claim can be retaken).
- Fake publisher keeps `posted` shape unchanged; options are logged in a parallel `postOptions` array.
- Fakes (1.11) have no direct tests; they are exercised by the PR1b use-case tests.

## Batch 2 — Phase 2 Use Case and Join (PR1b) — branch `feat/participation-usecase`

Mode: Strict TDD. Base: main bfec91d (PR1a merged). Completed: Step 0 (PR1a review warnings) + 2.1–2.11 (all of Phase 2).

### Step 0 (PR1a advisory warnings)

| Finding | Resolution |
|---|---|
| R3-002 fake repo `save` replaced the whole row | `fakeHackathonAnalysisRepo.save` now copies the row and keeps the stored `generalMessageId` (claims live in a separate map, so they were already preserved); `fakeAnalysisJobRepo.persistAnalysis` inherits it. Tests in `test/fakes/hackathon-analysis-repo.test.ts` (RED: 3 failed, then 5/5) |
| R3-001 refresh keeps non-null `generalMessageId` | Test added in `analyze-hackathon.test.ts`. It passed on first run because the carry-over line already existed (regression guard, not a true RED) |
| R2-001 detached `ChatPublisher.post` comment | Moved back above `ChatPublisher` |
| R2-002 `<` vs `<=` | design.md decision 3 and the ports.ts comment now say `<=` |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1/2.2 | `test/domain/hackathon/topic.test.ts` | Unit (pure) | N/A (new) | module missing | 9 tests pass | name, control/bidi, empty→slug, 128 cap, surrogate, ellipsis, link -100/non--100 | None needed |
| 2.3/2.4 | `test/domain/hackathon/argument.test.ts` | Unit (pure) | 5/5 | 5 failed (not a function) | 10/10 | join, bare, non-slug, 3 tokens, other→null | None needed |
| 2.5–2.5h/2.6 | `test/domain/usecases/participate-in-hackathon.test.ts` | Unit (fakes) | N/A (new) | module missing | 25/25 | happy, slug fallback, no link, redelivery, live, unknown, deleted, lost claim, busy, 4 refusals, uncertain keeps claim, pin/post/link failures, clear dedupe, null id | Concurrent test relaxed to accept busy or already (interleaving) |
| 2.7/2.9 | `test/adapters/telegram/participation.test.ts` | Unit (fakes) | N/A (new) | module missing | 13/13 | 7 refusal maps, safe General post failure, busy no-op, unrecognized rethrow | None needed |
| 2.8/2.9 | `test/adapters/telegram/commands.test.ts` (+12 join cases), `test/http/hackathon-command-e2e.test.ts` (+3) | Integration | 90+/all | 13 failed | all pass | admin/topic/General, usage x2, non-admin, stranger, unknown slug, old analysis, button clear, linkFailed, private chat, other multi-token unchanged; e2e create+clear, redelivery, no-rights | e2e ids made per-chat |
| 2.10 | `test/copy/catalog-language.test.ts` | Unit | pass | new catalogs failed to import | pass | denylist, non-empty, no voseo/usted | None needed |
| 2.11 | full suite | — | — | — | 997/997, typecheck clean | — | — |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and result | `npx vitest run test/domain test/adapters/telegram test/http/hackathon-command-e2e.test.ts test/copy test/fakes`: all green; full suite 76 files, 997/997 |
| Runtime harness | N/A: no fetch/LLM path; e2e drives the real Hono route, composition, D1 and adapters with stubbed Telegram HTTP |
| Rollback boundary | `participate-in-hackathon.ts`, `hackathon/topic.ts`, `participation.ts`, join branch in `hackathon-commands.ts`, `forumTopicManager` wiring in `composition.ts` |

### Commits
- `e8c6649` test(fakes): preserve generalMessageId and claim state on fake repo save
- `ed5fa16` docs(ports): restore ChatPublisher contract comment and align claim expiry to <=
- `09e9c7f` feat(hackathon): topic name, topic link and join argument helpers
- `097db02` feat(participation): use case, errors, domain copy
- `ed31694` feat(telegram): /hackathon join and runParticipation

### Deviations / notes
- Domain copy is one `participationCopy` object (`alreadyHasTopic`, `confirmed`, `postFailed`, `linkFailed`); adapter copy is `participateCopy`. A null link (chat id without `-100`) drops the link and separator.
- Use case result is `{kind, replyText}` with `busy` carrying `replyText: null`. `already` and `created` are delivered to General through the safe post (design decision 8), not `ctx.reply`; only pre-creation refusals use the command reply.
- `sanitizeTopicName` is exported from `topic.ts` (the confirmation shows the name without the emoji).
- A non-member is refused with the same `adminOnly` text: `UnauthorizedError` in the use case, `NotFoundError` mapped in `runParticipation`, and a direct reply in the join handler when membership cannot be resolved.
- An unknown error from `create` (not a `ForumTopicCreateError`) keeps the claim and rethrows: the topic may exist.
- `ForumTopicManager` is wired in `composition.ts` (needed by join); the button, `hp:` handler and consumer wiring stay in Phase 3.
- Phase 3 must keep the `runParticipation` `reply` param for the callback alert.

## Batch 3 — Phase 3 Button, Callback, Consumer (PR2) — branch `feat/participation-button`

Mode: Strict TDD. Base: main 934fd01 (PR1a and PR1b merged). Completed: Step 0 (PR1b review warning R3-001) + 3.1–3.10 (all of Phase 3).

### Step 0 (PR1b advisory warning)

| Finding | Resolution |
|---|---|
| R3-001 no test for a non-`ForumTopicCreateError` thrown by `create` | Test added in `participate-in-hackathon.test.ts`: the claim is kept (expiry in the future), the same error object is rethrown, nothing is linked or posted. It passed on first run because the branch already existed (regression guard, not a true RED) |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1/3.2 | `test/domain/usecases/run-hackathon-job.test.ts` | Unit (fakes) | 29/29 | 3 failed (no options, no stored id, no store-failure log) | 33/33 | fresh General, topic (no button, null id), store failure (ack, one post, log), persisted repost | Both General sites share `postToGeneral` |
| 3.3/3.4 | `test/adapters/telegram/commands.test.ts` | Unit | 120/120 | 3 failed (not a function) | pass | full ctx, absent thread/message id, missing chat/user | None needed |
| 3.5/3.6/3.7 | `test/adapters/telegram/commands.test.ts` (real grammY Bot + fakes) | Integration | 120/120 | 8 failed (no handler) | 131/131 | non-admin, non-member, admin, deduped/different buttons, early answer order, answer failure, redelivery, unknown slug, team from chat, 6 malformed payloads, private chat, `sel:` still works | None needed |
| 3.8 | `test/http/hackathon-command-e2e.test.ts` | Integration (real route, composition, D1) | 8/8 | 3 failed with the handler unregistered (verified by disabling it) | 11/11 | admin tap, non-admin alert, redelivery, malformed + foreign prefix ignored | None needed |
| 3.9 | composition | — | — | — | — | ➖ Nothing to wire: the consumer already had `chatPublisher` and `hackathonAnalysisRepo`; the callback rides `registerHackathonCommands` | ➖ |
| 3.10 | full suite | — | — | — | 1027/1027 (76 files), typecheck clean | — | — |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and result | `npx vitest run test/domain/usecases/run-hackathon-job.test.ts test/adapters/telegram test/http`: all green; full suite 76 files, 1027/1027, `npm run typecheck` clean |
| Runtime harness | N/A: no fetch/LLM path; e2e drives the real Hono route, composition, D1 and adapters with stubbed Telegram HTTP |
| Rollback boundary | `postToGeneral` in `run-hackathon-job.ts`, `callbackCallerLocation` in `context.ts`, `registerParticipationCallback` and its one-line registration in `hackathon-commands.ts` |

### Commits
- `94d4ba1` test(participation): cover unknown create error keeping the claim and rethrowing
- `812929c` feat(hackathon): post the General analysis with the participation button and store its message id
- `fe92e95` feat(telegram): confirm participation from the hp callback button
- `74f8924` test(http): cover the hp callback through the webhook route
- `9d2cfa1` docs: tasks and apply-progress (this file)

### Deviations / notes
- Handler tests live in `commands.test.ts` (which already has the real-Bot harness with alert recording), not `participation.test.ts` as tasks 3.5/3.6 name it. The `callbackCallerLocation` tests are there too, as in 3.3.
- `callbackCallerLocation` returns `CallbackLocation = CallerLocation & { messageId }`, so the button message id travels with the location.
- Order in the handler: the role is resolved first (fast, no use case). A non-member or non-admin gets the single alert (one `answerCallbackQuery` per query allows only one). An admin is answered silently and early, then `runParticipation` runs. Its `reply` (pre-creation refusals such as missing rights) is therefore a best-effort `ctx.reply`, not an alert, because the query is already answered.
- Slug length is capped at 40 in the handler (slug.ts limit) on top of the design regex.
- The `setGeneralMessageId` failure is logged as `hackathon-job` / `general-message-id-store-failed`. Consequence: the stored message's button is not cleared on join (the tapped message's own button still is).
- The persisted repost site also stores the message id, so a repost after a crash replaces the stored id with the newest message.
- The only new e2e coverage is the `hp:` callback; other prefixes were already ignored (only `sel:` and `hp:` handlers exist), so no routing code changed in `index.ts`.

## Fix: existing-topic check by posting (branch `fix/participation-topic-check`)

Production evidence: after the user deleted topic 262, `/hackathon join` still replied "Este hackathon ya tiene tema" (`hackathon-join outcome ok`). `ForumTopicManager.probe` used `sendChatAction`, and Telegram accepts a chat action for a deleted thread, so the check never detected the deletion.

- `participateInHackathon` now verifies a linked topic by posting the analysis into it through `postAnalysisAndLinkTopic` (which also re-pins and refreshes `pinnedMessageId`).
  - Post succeeds: the topic is live, reply `already(link)`.
  - `PublishFailedError` with `failureClass === "rejected"`: the topic is deleted, then the existing claim, create, link, post/pin, confirm path runs.
  - Any other failure (`telegram-unavailable`, `rate-limited`, unexpected errors): unknown, logged as `topic-check-failed`, reply `already(link)`, never recreate.
- `probe`, `TopicProbe`, the adapter probe and its classifier, the fake probe and the adapter probe tests were removed (nothing else used them). The e2e `sendChatAction` stubs were dropped.
- TDD: RED first (4 failing tests: live post, deleted via rejected post, unavailable and rate-limited without recreate, redelivery after recreation), then GREEN. Focused file 28/28, `npm run typecheck` clean, full suite 76 files, 1018/1018 (was 1027; the 10 probe tests were removed, 1 net new use-case test).
- Known limit: a live re-check re-posts the analysis and re-pins it; the previous pinned message stays pinned (Telegram allows several pins).
- Commits: `3e648d6` fix(participation) code and tests, `65c2fac` docs (design decision 2, spec scenario, proposal).
