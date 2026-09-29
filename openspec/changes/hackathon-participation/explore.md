# Exploration: hackathon-participation (roadmap change 4)

Mirror of engram `sdd/hackathon-participation/explore` (hybrid store).

## Current State

- `/hackathon <url>` (admin, General): the producer enqueues. In General (`threadId` null), the consumer `runHackathonJob` persists the analysis and then calls `chatPublisher.post(chat, null, text)`. It keeps no message id, creates no link and pins nothing. In a topic, the consumer calls `postAnalysisAndLinkTopic` instead, which posts, pins best-effort, and links through `moveTopicLink` in one atomic D1 batch.
- `/hackathon <slug>` from an admin inside a topic calls `linkAnalysisToTopic` (admin gate, `findBySlug`, `postAnalysisAndLinkTopic`). Any member anywhere else gets `showAnalysis`, which is plain text with no side effects.
- `hackathon_analyses` has `thread_id` and `pinned_message_id`, with a partial UNIQUE index on `(team_id, thread_id) WHERE thread_id IS NOT NULL`. `thread_id` alone is enough to know that an analysis already has a topic, so the basic flow needs no migration.
- The `ChatPublisher` port only has `post`, `pin` and `unpin`. Nothing calls `createForumTopic`, and nothing supports `reply_markup`. The only `callbackQuery` handler is the team picker `sel:<teamId>`, which is DM only.
- `callerLocation()` reads `ctx.message`, so for a `callback_query` it returns `threadId` null. It needs a variant based on `ctx.msg`.
- `/hackathon` refuses any argument containing whitespace with a BadArgument usage reply. `/hackathon join <slug>` is therefore refused today: the syntax is free, but the whitespace check must change. A bare `join` is a valid slug shape.
- Webhook policy: an unrecognized error is rethrown, the webhook returns 500, and Telegram redelivers the same update. That is dangerous after a side effect such as creating a topic.
- `openspec/specs/telegram-webhook` says the bot only sees commands under default privacy. `BOT_INFO.can_read_all_group_messages=false` is only a cached `getMe` var; grammY uses only its id and username.

## Key finding: privacy mode vs admin

The Telegram Bots FAQ says: "Bot admins and bots with privacy mode disabled will receive all messages except messages sent by other bots." The bot is a group admin, so it very likely ALREADY receives plain free text in General, whatever the BotFather privacy setting says. The premise that plain text will not reach it is probably wrong for this deployment.

This is UNVERIFIED in production. The cheap test is to post plain text in General and check Worker observability for an update that no handler processed.

Under true privacy mode, these are the documented deliveries:
- commands (`/cmd@bot`)
- general commands, when the bot was the last sender
- replies to the bot's messages
- service messages
- inline-via-bot messages

@mention delivery is NOT in the official list, and community reports conflict, so do not rely on it. Callback queries are always delivered.

## Approaches

| | A `/hackathon join <slug>` | B reply-to-bot text | C NL classifier | D inline button |
|---|---|---|---|---|
| Delivery | Command, always delivered | Documented for replies to the bot; works under privacy | Needs all messages: the admin bot probably gets them already (verify), or privacy must be off | `callback_query`, always delivered |
| Neurons | 0 | 0 with keywords; with the LLM, ~10 per reply (estimate) | One LLM call per candidate message. Needs a regex prefilter: unfiltered, ~500 msgs × ~10 is half the free 10k/day | 0 |
| Security | Admin gate, deterministic | Ambiguity, spoofed phrasing, and an LLM misfire creates a topic | Reads all team chat (privacy and PII posture), prompt injection, false positives; a wrong topic is hard to undo | Admin gate on the tapper; the payload only carries the slug; the team comes from the chat id |
| Testability | Trivial (fake ports) | Medium: multilingual keywords are brittle | Hard: needs the real-model harness (project rule) | Good: callback fixtures exist in `commands.test.ts` |
| Complexity | Low | Medium: the slug comes from the reply's `Slug:` line or from a stored message id | High | Low to medium |
| Matches "we say we'll participate" | No | Partly | Yes | No (a tap, not text) |

## Recommendation

Change 4 is D + A, both built on ONE use case, `participateInHackathon`. It checks the admin gate, looks up `findBySlug`, checks idempotency, then calls `createForumTopic`, links, posts and pins.

- The General analysis gets a "Participamos" button (`callback_data` `hp:<slug>`, ≤64 bytes).
- `/hackathon join <slug>` is the fallback for old messages and for when the button fails.

This is deterministic, costs zero neurons, is testable, and needs no privacy change.

Defer NL (C) to a follow-up that REUSES the same use case. The flow would be:
1. A regex prefilter (es/en).
2. An optional LLM enum classifier.
3. The bot asks for confirmation with the D button, so the LLM never triggers side effects directly.

B is a subset of C's UX, so skip it as a standalone option.

## Design notes for the proposal

- **Topic name:** `fields.name.value`, falling back to the slug.
  - Strip control characters, collapse whitespace, and cap at ~100 characters (Telegram allows 1–128).
  - An optional leading emoji can go in the name text.
  - `icon_color` is optional. The classic six values are 7322096, 16766590, 13338331, 9367192, 16749490 and 16478047; re-verify them at design time.
  - Page-derived text is untrusted and stays plain text only.
- **Ports:** add a new port (ISP), `ForumTopicManager.create(chatId, name) -> threadId`, or extend `ChatPublisher`. Classify Telegram rejections (not enough rights, not a forum) into distinct replies. Extend `post()` with an optional inline keyboard.
- **Idempotency:** if `analysis.threadId != null`, create nothing. Reply "already has a topic" with a `t.me/c/<chatId minus -100>/<threadId>` link.
  - Concurrent taps: the recommended option is an optional migration 0004 that adds `topic_claim_at` plus a conditional UPDATE claim. The alternative is to accept the small race.
- **After `createForumTopic` succeeds:**
  - Link immediately (`moveTopicLink(thread, pinned null)`), then call `postAnalysisAndLinkTopic`, which is idempotent for the same id.
  - Never rethrow after the topic is created: a 500 means redelivery, which means a second topic.
  - On partial failure, reply with a recovery hint.
- **Failures:**
  - Missing `can_manage_topics` or not a forum: give an operator instruction and persist nothing.
  - Pin fails: use the existing note; the link persists.
  - Post fails: the topic exists and is linked; send a recovery reply.
  - Topic deleted later: `thread_id` goes stale. `/hackathon <slug>` in a new topic already moves the link.
- **Permissions:** admin only. A non-admin tap gets an `answerCallbackQuery` alert. Membership comes from the chat id plus `ctx.from.id`. Answering the callback and dropping the button are best-effort.
- **Cost:** ~3 Telegram calls and 2 D1 operations, synchronous, 0 neurons, no queue.

## Affected Areas

- `src/domain/ports.ts`
- `src/adapters/telegram/chat-publisher.ts`
- `src/domain/usecases/participate-in-hackathon.ts` (new)
- `src/domain/usecases/run-hackathon-job.ts` (the two General post sites)
- `src/domain/usecases/show-analysis.ts`
- `src/adapters/telegram/hackathon-commands.ts` (join subcommand, `callbackQuery`, ERROR_REPLIES)
- `src/adapters/telegram/context.ts`
- `src/composition.ts`
- `src/domain/errors.ts`
- The openspec spec delta
- An optional `migrations/0004`
- Tests

## Review size

Medium: ~350–500 changed lines including tests, which is borderline against the 400-line limit. Suggest 2 PRs:
1. Port, adapter, use case and `/hackathon join`.
2. Button, callback handler and consumer wiring.

Review lenses: reliability, plus resilience.

## Risks

- That an admin bot receives all messages is documented but unverified in production.
- A double topic on redelivery or on concurrent taps.
- The bot may lack `can_manage_topics`. This is an operator step and needs docs.
- Old analyses have no button, and the General message id is not stored.
- Any change to the LLM path needs `npm run harness`.

## Open product questions

1. Who may confirm: admins only, or any member?
2. Button plus `/hackathon join` now, with free-text NL later as a confirm-first change?
3. Topic name, emoji and icon colour?
4. Recreate the topic if it was deleted manually?
5. Post a confirmation with the topic link in General?
6. Accept a 5-minute production test of plain-message delivery?
7. Follow-ups on participation (suggest `/linkrepo`, reminders)?

## Ready for Proposal

Yes: D + A.
