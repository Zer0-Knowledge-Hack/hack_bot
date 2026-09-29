# Tasks: Confirm Hackathon Participation and Create Its Topic

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1200 (PR1a ~350, PR1b ~450, PR2 ~400) |
| 400-line budget risk | High (aggregate); PR1a Low, PR1b/PR2 Medium (likely `size:exception` if over 400) |
| Chained PRs recommended | Yes |
| Suggested split | PR1a infrastructure → PR1b use case + join → PR2 button + callback |
| Delivery strategy | 3 chained PRs (decided; split recommended by design) |
| Chain strategy | stacked-to-main (each PR targets `main` after the previous merges) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Mark PR1b and PR2 as likely `size:exception` if they exceed 400 lines.
No `npm run harness` needed: no fetch, LLM or validation path is touched.
Each PR is independently deployable and keeps `npm test` green. PR1a adds unused-but-tested infrastructure; migration 0004 is additive.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Migration 0004, D1 claim/release/message-id, `ForumTopicManager` + adapter, `clearButtons`, fakes | PR1a (~350) | `npm test -- test/adapters` | N/A: infrastructure unused until PR1b | new files + additive columns (ignored on revert) |
| 2 | Pure helpers, `participateInHackathon`, `/hackathon join`, copy | PR1b (~450) | `npm test -- test/domain test/adapters/telegram/commands.test.ts` | N/A: no fetch/LLM path | `participate-in-hackathon.ts`, `participation.ts`, join branch |
| 3 | General-post button, `hp:` callback, routing, wiring | PR2 (~400) | `npm test -- test/adapters/telegram test/domain/usecases/run-hackathon-job.test.ts test/http` | N/A: no fetch/LLM path | `postToGeneral`, `hp:` handler, `callbackCallerLocation` |

## Phase 1: Infrastructure (PR1a)

- [x] 1.1 RED: `test/adapters/migrations.test.ts` — 0004 adds `general_message_id` (nullable) and `topic_claim_until` (NOT NULL DEFAULT 0); existing rows keep defaults.
- [x] 1.2 GREEN: create `migrations/0004_hackathon_participation.sql` (two additive `ADD COLUMN`).
- [x] 1.3 RED: `test/adapters/d1/hackathon-analysis-repo.test.ts` — **concurrent taps (the claim)**: `claimTopicCreation` CAS wins on `thread_id IS NULL`, wins on `IS stale`, loses when another claim is live, wins after TTL expiry; two claims race and exactly one wins.
- [x] 1.4 RED: same file — `releaseTopicClaim` reopens the claim; `setGeneralMessageId` stores the id; `save`/`persistAnalysis` never clobber `general_message_id`/`topic_claim_until`; rows without an id read `generalMessageId: null`.
- [x] 1.5 GREEN: `src/domain/entities.ts` (`generalMessageId`), `src/domain/ports.ts` (`HackathonAnalysisRepo` additions), `src/adapters/d1/hackathon-analysis-repo.ts` (CAS `UPDATE`, release, set id, row mapping).
- [x] 1.6 RED: create `test/adapters/telegram/forum-topic-manager.test.ts` (injected `Api` stub) — `create` classification: `not enough rights`/`chat_admin_required` → `no-rights`; `not a forum`/`channel_forum_missing` → `not-forum`; 429 → `rate-limited`; other 4xx → `rejected`; `HttpError`/5xx/timeout → `unavailable`; returns `message_thread_id` on success.
- [x] 1.7 RED: same file — **deleted topic detected**: `probe` via `sendChatAction("typing", {message_thread_id})`: ok → `live`; 400 `message thread not found`/`TOPIC_ID_INVALID`/`TOPIC_DELETED` → `deleted`. **Ambiguous probe error treated as live**: other 400, 403, 429, 5xx, timeout → `unknown`; never throws.
- [x] 1.8 GREEN: `src/domain/ports.ts` (`ForumTopicManager`, `TopicProbe`, `TopicCreateFailure`, `PostOptions`), `src/domain/errors.ts` (`ForumTopicCreateError`), create `src/adapters/telegram/forum-topic-manager.ts`.
- [x] 1.9 RED: `test/adapters/telegram/chat-publisher.test.ts` — `clearButtons` calls `editMessageReplyMarkup` with no `reply_markup`; `post` accepts optional `{ participateSlug }` without altering the no-option payload; when set, the keyboard carries `hp:<slug>` (≤ 64 bytes) and label "✅ Participamos".
- [x] 1.10 GREEN: `src/adapters/telegram/chat-publisher.ts` (`clearButtons`, `PostOptions` keyboard); `src/adapters/telegram/copy.ts` (`participateButton`).
- [x] 1.11 GREEN: `test/fakes/index.ts` — `FakeForumTopicManager` (scripted outcomes, call log), fake repo claim/release/message-id, fake publisher `clearButtons` and options log.
- [x] 1.12 Run `npm test` and `npm run typecheck`; green with infrastructure unused.

## Phase 2: Use Case and Join Command (PR1b)

- [ ] 2.1 RED: `test/domain/hackathon/topic.test.ts` — `topicNameFor` (control/bidi chars stripped, whitespace collapsed, empty → slug, `🏆 ` prefix, ≤128 UTF-16 units, no split surrogate, `…` when cut); `topicLink` (`-100` stripped, non-`-100` → null).
- [ ] 2.2 GREEN: create `src/domain/hackathon/topic.ts`.
- [ ] 2.3 RED: `test/domain/hackathon/argument.test.ts` — `parseJoinArgument`: `join meridian` → join+slug; bare `join`, `join Not_Slug`, `join a b` → `join-usage`; other arguments → null (existing rules unchanged).
- [ ] 2.4 GREEN: `src/domain/hackathon/argument.ts` (`parseJoinArgument`, checked before the whitespace rule).
- [ ] 2.5 RED: create `test/domain/usecases/participate-in-hackathon.test.ts` — non-admin/non-member → `UnauthorizedError`, unknown slug → `AnalysisNotFoundError`, nothing changes; happy path fresh topic created, linked, pinned, General text `confirmed(name, link)`.
- [ ] 2.5a RED: same file — **redelivery never creates a second topic**: second call after success returns `already(link)`, exactly one `create`.
- [ ] 2.5b RED: same file — live topic (`live`) → `already`, no create; **ambiguous probe error treated as live (no recreate)**: `unknown` → `already`, no create, buttons cleared best-effort.
- [ ] 2.5c RED: same file — **deleted topic detected and recreated**: `deleted` → claim with `expected = stale id`, new topic created, stale id replaced, no spurious unpin/"moved" note.
- [ ] 2.5d RED: same file — **concurrent taps**: claim loss then re-read linked → `already`; not linked → `busy` (neutral no-op, nothing posted); exactly one `create` across two calls.
- [ ] 2.5e RED: same file — **missing Manage Topics / not a forum (nothing persisted)**: `no-rights` → `TopicRightsMissingError`, `not-forum` → `ChatNotForumError`; claim released, no link stored. `rate-limited`/`rejected` → `TopicCreationFailedError`, claim released. `unavailable` → `TopicCreationUncertainError`, claim kept.
- [ ] 2.5f RED: same file — **pin failure**: analysis posted unpinned, link persists, `pinFailed` note in result.
- [ ] 2.5g RED: same file — **post failure after topic creation (never rethrows)**: link persists, result `postFailed(slug, link)`; `moveTopicLink` failure → `linkFailed(slug, link)`; `clearButtons` failure ignored; clears the deduped set {callback message id, `generalMessageId`}.
- [ ] 2.5h RED: same file — **old analyses without a message id**: `generalMessageId: null` → join works, nothing to clear, no `clearButtons` call for it.
- [ ] 2.6 GREEN: `src/domain/errors.ts` (`TopicRightsMissingError`, `ChatNotForumError`, `TopicCreationFailedError`, `TopicCreationUncertainError`), `src/domain/copy.ts` (`alreadyHasTopic`, `confirmed`, `postFailed`, `linkFailed`), create `src/domain/usecases/participate-in-hackathon.ts` with the design step order (no-throw zone from `moveTopicLink`).
- [ ] 2.7 RED: `test/adapters/telegram/participation.test.ts` — `runParticipation` maps each domain error by name to its Spanish reply (`adminOnly`, `noAnalysis(slug)`, `noRights`, `notForum`, `createFailed` "Telegram rechazó la creación del tema. Inténtalo de nuevo en un minuto.", `createUncertain` "No se pudo confirmar si se creó el tema. Revisa la lista de temas antes de volver a intentarlo."); a failing safe General post is caught and logged, never rethrown (no 500).
- [ ] 2.8 RED: `test/adapters/telegram/commands.test.ts` (hackathon cases) and `test/http/hackathon-command-e2e.test.ts` — `/hackathon join <slug>` runs participation with no fetch/cap; `join` usage line "Uso: /hackathon join <slug>"; non-admin reply; unknown-slug reply; `join <slug>` on an old analysis works; `linkFailed` reply text.
- [ ] 2.9 GREEN: create `src/adapters/telegram/participation.ts` (`runParticipation`, safe General post); `src/adapters/telegram/copy.ts` (all adapter strings from the design copy table); `src/adapters/telegram/hackathon-commands.ts` (join branch); `src/composition.ts` (wire use case, `ForumTopicManager`).
- [ ] 2.10 Extend `test/copy/catalog-language.test.ts` to the new catalog entries (non-empty, Spanish, no English denylist match, neutral "tú"); make it pass.
- [ ] 2.11 Run `npm test` and `npm run typecheck`; join works, button not yet rendered.

## Phase 3: Button, Callback, Consumer (PR2)

- [ ] 3.1 RED: `test/domain/usecases/run-hackathon-job.test.ts` — General post is sent with `participateSlug` and `setGeneralMessageId` stores the returned id at both General sites; a topic post has no button; a `setGeneralMessageId` failure is logged, the job still acks, and there is no retry/repost.
- [ ] 3.2 GREEN: `src/domain/usecases/run-hackathon-job.ts` — `postToGeneral(text, participateSlug)` helper used by both General sites; best-effort id store.
- [ ] 3.3 RED: `test/adapters/telegram/commands.test.ts` — `callbackCallerLocation(ctx)` reads `ctx.chat.id`, `ctx.from.id`, `ctx.msg?.message_thread_id`, `ctx.callbackQuery.message?.message_id`; `callerLocation` behavior for commands unchanged.
- [ ] 3.4 GREEN: `src/adapters/telegram/context.ts` (`callbackCallerLocation`).
- [ ] 3.5 RED: `test/adapters/telegram/participation.test.ts` — **non-admin alert**: `hp:<slug>` from a non-admin (and non-member) → `answerCallbackQuery` with `show_alert` "Solo un administrador del equipo puede confirmar la participación.", nothing created, button stays; private/missing chat ignored; team taken from chat id, never the payload; malformed data (`hp:Bad_Slug`, over-long) ignored; admin tap creates the topic.
- [ ] 3.6 RED: same file — **button removed after confirmation**: admin tap → `clearButtons` for the callback message id and the stored `generalMessageId` (deduped); button-clear failure ignored; callback answered early, best-effort.
- [ ] 3.7 GREEN: `src/adapters/telegram/participation.ts` (`bot.callbackQuery(/^hp:(slug)$/)` handler, registered from `registerHackathonCommands`); `src/adapters/telegram/hackathon-commands.ts`.
- [ ] 3.8 RED: `test/http/webhook-e2e.test.ts` and `test/http/hackathon-command-e2e.test.ts` — validated webhook `hp:` callback from a group is routed to the participation handler; callback with any other prefix is ignored without error; `/hackathon join` clears the stored message's button (old analysis with null id: join works, nothing removed).
- [ ] 3.9 GREEN: `src/composition.ts` wiring (consumer uses `postToGeneral`, handler gets `ForumTopicManager`); `test/fakes/index.ts` and `test/support/telegram-stub.ts` callback fixtures/`answerCallbackQuery`/`editMessageReplyMarkup` recording.
- [ ] 3.10 Run `npm test` and `npm run typecheck`.

## Phase 4: Operator Step and Final Verification (after PR2)

- [ ] 4.1 Operator: apply migration 0004 remotely, deploy, then grant the bot "Manage Topics" (Administrar temas) in the group.
- [ ] 4.2 Operator smoke test in Telegram: tap "✅ Participamos" (topic created, pinned, General confirmation, button removed); delete the topic and tap again on a fresh analysis or `join` (recreated, validates probe strings); check the `t.me/c/...` link opens the topic; run `/hackathon join <slug>` on an old analysis.
- [ ] 4.3 Run the full suite (`npm test`) and typecheck (`npm run typecheck`), both green.
