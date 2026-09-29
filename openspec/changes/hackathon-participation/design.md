# Design: Confirm Hackathon Participation and Create Its Topic

## Technical Approach

Hexagonal, same as change 3. There is one pure use case, `participateInHackathon`, with two thin grammY triggers:
- the `hp:<slug>` callback on the General analysis post;
- `/hackathon join <slug>`.

The use case owns five things: the admin gate, the slug lookup, the existing-topic check (a real post), a D1 compare-and-set claim, and topic creation. It then links through the existing `moveTopicLink` / `postAnalysisAndLinkTopic` flow and removes the button. Telegram access sits behind a new `ForumTopicManager` port plus two small `ChatPublisher` additions. The domain never imports grammY. The consumer (`runHackathonJob`) attaches the button to its two General post sites and stores the message id. Specs: `specs/hackathon-participation`, plus the deltas for `hackathon-analysis` and `telegram-webhook`.

## Architecture Decisions

| # | Topic | Choice | Rejected (tradeoff) |
|---|---|---|---|
| 1 | Ports | New ISP port `ForumTopicManager { create }`. `ChatPublisher.post` gains an optional `PostOptions { participateSlug?: string }`, which is semantic, not a keyboard. It also gains `clearButtons(chatId, messageId)`. The adapter owns the label, the `hp:` encoding and `editMessageReplyMarkup` (omitting `reply_markup` removes the keyboard). | Extending `ChatPublisher` with topic methods: the consumer would see topic rights it never needs. A domain-built `{label,data}` keyboard would leak the Telegram payload format into the domain. |
| 2 | Existing-topic check | Do the real action: `postAnalysisAndLinkTopic` posts (and re-pins) the analysis into the linked thread. **Post succeeds ⇒ the topic is live**: reply `already(link)`; the analysis is re-posted there. A `PublishFailedError` classified `thread-gone` (the adapter assigns it only to a 400 whose description matches `message thread not found`, `TOPIC_ID_INVALID` or `TOPIC_DELETED`) ⇒ the topic is deleted: `expected = threadId`, then claim → create → link → post/pin → confirm. `rejected` (any other 4xx: a closed topic or missing rights on a live topic), `telegram-unavailable` and `rate-limited` (5xx, network, 429) ⇒ unknown: never recreate on ambiguity, reply `already(link)`. | `sendChatAction(chat, "typing", {message_thread_id})`: production showed Telegram accepts a chat action for a deleted thread, so it never detected the deletion. `editForumTopic`, `closeForumTopic`/`reopenForumTopic`: they need `can_manage_topics` and change topic state. Treating every `rejected` as deleted: a live topic can return 400 TOPIC_CLOSED or 403, so it would create a duplicate topic. The `PublishFailedError.failureClass` carries the classification, so grammY and description matching stay in the adapter and the domain stays free of Telegram error strings. |
| 3 | Concurrency and redelivery | **(a) Migration 0004 with a claim.** `topic_claim_until` is set by a conditional `UPDATE … WHERE team_id=? AND id=? AND thread_id IS ?expected AND topic_claim_until <= ?now` (CAS on the observed `thread_id`: null, or the stale id). TTL is 60 s. | (b) Accepting the race. Webhook `max_connections` defaults to 40, so parallel taps are real, and the cost (a duplicate public topic) is visible and manual to undo. |
| 4 | Button and message id | Migration 0004 adds `general_message_id`. A helper `postToGeneral` in `run-hackathon-job` (used by both General sites) posts with `participateSlug`. It then calls `setGeneralMessageId`, best-effort: catch and log, never retry, because a retry would repost. Each repost overwrites the id; old buttons stay idempotent. `/hackathon join` clears the stored id's button. Old analyses have null, so nothing is cleared. | Not storing the id: `join` could never remove the button. |
| 5 | Callback handling | `bot.callbackQuery(/^hp:([a-z0-9]+(?:-[a-z0-9]+)*)$/)`. A private chat or a missing chat is ignored. The new `callbackCallerLocation(ctx)` reads `ctx.chat.id`, `ctx.from.id`, `ctx.msg?.message_thread_id` and `ctx.callbackQuery.message?.message_id`. The team comes from `teamRepo.findByChatId` and the role from `ctx.from.id` (`resolveGroupMembership`). Non-members and non-admins get the same alert (`show_alert`). The handler answers the callback early and best-effort. | Changing `callerLocation` to `ctx.msg`: it would widen every command to edited or channel messages. Trusting a team id in the payload is ruled out by the spec. |
| 6 | Argument parsing | A new pure `parseJoinArgument(arg)` in `domain/hackathon/argument.ts`, checked **before** the whitespace rule. It returns `join` + slug when the argument is `^join\s+(\S+)$` and the slug is slug-shaped. It returns `join-usage` for a bare `join`, for `join <non-slug>` and for `join a b`. Otherwise it returns null, and the existing rules apply. | Loosening the whitespace rule globally. |
| 7 | Deep link | A pure `topicLink(chatId, threadId)`: `https://t.me/c/${String(chatId).slice(4)}/${threadId}` when the chat id starts with `-100`, otherwise null (the reply then omits the link). This is the format Telegram's "Copy link" produces for a topic, since a topic id is its creation message id. It opens only for members. **Verify in the smoke test.** | A `t.me/<username>` link (most team groups are private). |
| 8 | Error-to-reply | Pre-creation refusals are domain errors mapped by name (`runCommand` pattern). Everything after a successful `create` returns a result and never throws. The adapter delivers `replyText` to General with a safe post (catch and log, no rethrow) so a failed reply cannot produce a 500 and a redelivery. | `ctx.reply` inside `runCommand`: its failure rethrows and causes a 500. |

## Use Case Step Order (`participateInHackathon`)

1. Membership role check: not an admin ⇒ `UnauthorizedError`. `findBySlug` finds nothing ⇒ `AnalysisNotFoundError`.
2. `threadId != null` ⇒ post the analysis into that thread. On success or an unknown failure (`rejected`, `telegram-unavailable`, `rate-limited`, unexpected errors; logged as `topic-check-failed`): clear the buttons (best-effort) and return `already(link)`. On a `thread-gone` post: set `expected = threadId`.
3. `claimTopicCreation(expected, now, 60s)`. If it returns false, re-read the analysis. Linked ⇒ `already(link)`. Otherwise `busy`, a neutral no-op: the callback is answered silently and nothing is posted.
4. `create(chat, topicNameFor(analysis))` can fail as follows:

   | Failure | Claim | Error | Rationale |
   |---|---|---|---|
   | `no-rights` | Released | `TopicRightsMissingError` | Net state unchanged ("persist nothing") |
   | `not-forum` | Released | `ChatNotForumError` | Same |
   | `rate-limited` or `rejected` | Released | `TopicCreationFailedError` | Same |
   | `unavailable` (timeout or 5xx: the topic may exist) | **Kept** | `TopicCreationUncertainError` | The TTL blocks an immediate duplicate |

5. **The no-throw zone starts here.** Call `moveTopicLink(T, pinned=null)`, which also replaces a stale id. On failure, return `linkFailed(link)`.
6. Wait `TOPIC_POST_DELAY_MS` (1500 ms) through the injected `sleep`, then call `postAnalysisAndLinkTopic({threadId: T, analysis: {...analysis, threadId: T}, pinDelayMs: PIN_DELAY_MS})`, which waits `PIN_DELAY_MS` (1000 ms) between the post and the pin. Production showed a pin issued right after the post into a just-created topic return `ok` yet never pin. The delays apply to the fresh-topic path only (the live-topic check and other callers pass no delay); `sleep` is a `Sleep` dependency wired to `setTimeout` in the composition root, so the domain owns no timer. The 2.5 s total is idle wall-clock time, not CPU. The threadId override avoids a spurious unpin and a "moved" note. If the post fails, return `postFailed(link)`. A pin failure adds the existing `pinFailed` note.
7. Clear the buttons, best-effort, for the deduped set of {callback message id, `generalMessageId`}. Return `created(name, link, notes)`.

## Data Flow

```
tap hp:<slug> ─ callbackCallerLocation ─ member+admin? ─no→ alert
/hackathon join <slug> ─ parseJoinArgument ─┐       │yes
                                            └─ participateInHackathon
   post-check ─ claim(CAS) ─ create ─ moveTopicLink ─ post+pin (existing) ─ clearButtons
   └→ replyText ─ safe post to General (threadId null)
consumer: postToGeneral(text, participateSlug) ─ setGeneralMessageId (best-effort)
```

## Interfaces / Contracts

```ts
type TopicCreateFailure = "no-rights" | "not-forum" | "rate-limited" | "rejected" | "unavailable";
interface ForumTopicManager {
  create(chatId: number, name: string, options?: { iconEmoji: string; fallbackName: string }): Promise<number>;      // throws ForumTopicCreateError(failure)
}
interface ChatPublisher { post(chatId, threadId, text, options?: { participateSlug?: string }): Promise<number>;
  pin; unpin; clearButtons(chatId: number, messageId: number): Promise<void>; }
// HackathonAnalysisRepo additions; HackathonAnalysis gains generalMessageId: number | null
claimTopicCreation(team, id, expectedThreadId: number | null, now: number, ttlMs: number): Promise<boolean>;
releaseTopicClaim(team, id): Promise<void>;
setGeneralMessageId(team, id, messageId: number): Promise<void>;
```

`save` and `persistAnalysis` keep their explicit column lists, so the new columns take their defaults and are never clobbered. Adapter classification of `createForumTopic` (a `GrammyError` description, lowercased):
- `not enough rights` or `chat_admin_required` ⇒ `no-rights`;
- `not a forum` or `channel_forum_missing` ⇒ `not-forum`;
- 429 ⇒ `rate-limited`;
- other 4xx ⇒ `rejected`;
- `HttpError`, 5xx or a timeout ⇒ `unavailable`.

Topic name: strip `\p{Cc}\p{Cf}` (bidi spoofing too), collapse whitespace and trim; fall back to the slug; the result is the plain name, cut at code-point boundaries to at most 128 UTF-16 units, with `…` when cut. The 🏆 is the topic **icon**, not part of the name: the use case passes `create(chatId, name, { iconEmoji: "🏆", fallbackName })`, where `fallbackName` is the same name prefixed with `🏆 ` (cut to 128 units including the prefix). The adapter calls `getForumTopicIconStickers()`, picks the sticker whose `emoji` equals the hint (U+FE0F stripped on both sides) and calls `createForumTopic` with `icon_custom_emoji_id`; bots may use these ids without Premium. The icon list is cached per isolate as a promise that is cleared on rejection. When there is no match, or the list call fails, the topic is created without an icon and named `fallbackName`; an icon failure never fails the creation. The domain never learns which variant won, so the port stays free of Telegram types. The General confirmation shows the plain sanitized name.

## Copy Table (spec strings are authoritative)

| Key | Catalog | Text |
|---|---|---|
| `participateButton` | adapter | ✅ Participamos |
| `adminOnly` (alert + reply) | adapter | Solo un administrador del equipo puede confirmar la participación. |
| `joinUsage` | adapter | Uso: /hackathon join <slug> |
| `noAnalysis(slug)` | adapter | No se encontró ningún análisis con el slug <slug>. |
| `noRights` | adapter | No puedo crear temas: concede al bot el permiso «Administrar temas» y vuelve a intentarlo. |
| `notForum` | adapter | Este grupo no tiene los temas activados. Actívalos en la configuración del grupo y vuelve a intentarlo. |
| `createFailed` | adapter | *(design-proposed)* Telegram rechazó la creación del tema. Inténtalo de nuevo en un minuto. |
| `createUncertain` | adapter | *(design-proposed)* No se pudo confirmar si se creó el tema. Revisa la lista de temas antes de volver a intentarlo. |
| `alreadyHasTopic(link)` | domain | Este hackathon ya tiene tema: <link> |
| `confirmed(name, link)` | domain | ✅ Participamos en <name> → <link> |
| `postFailed(slug, link)` | domain | Se creó el tema y se vinculó <slug>, pero no se pudo publicar el análisis. Ejecuta /hackathon <slug> dentro del tema: <link> |
| `linkFailed(slug, link)` | domain | *(design-proposed)* Se creó el tema, pero no se pudo vincular <slug>. Ejecuta /hackathon <slug> dentro del tema: <link> |
| `pinFailed` | domain (existing) | No se pudo fijar el mensaje; se publicó sin fijar. |

## File Changes and PR Split

| PR | Files | Est. lines (src + tests) |
|---|---|---|
| 1: port, adapter, use case, join | `migrations/0004_hackathon_participation.sql` (new); `src/domain/{entities,ports,errors,copy}.ts`; `src/domain/hackathon/{topic.ts (new), argument.ts}`; `src/domain/usecases/participate-in-hackathon.ts` (new); `src/adapters/telegram/forum-topic-manager.ts` (new); `chat-publisher.ts` (`clearButtons`); `src/adapters/d1/hackathon-analysis-repo.ts`; `src/adapters/telegram/participation.ts` (new: `runParticipation`, safe General post); `hackathon-commands.ts` (join branch); `telegram/copy.ts`; `composition.ts`; `test/fakes/index.ts`; tests | ~380 + ~420 ≈ **800** |
| 2: button, callback, consumer | `ports.ts` + `chat-publisher.ts` (`PostOptions` + keyboard); `context.ts` (`callbackCallerLocation`); `participation.ts` (`hp:` handler, registered from `registerHackathonCommands`); `run-hackathon-job.ts` (`postToGeneral` at both General sites); `telegram/copy.ts` (button); fakes; tests | ~135 + ~270 ≈ **400** |

PR1 exceeds the 400-line budget. `sdd-tasks` should split it:
- 1a: migration, D1 repo, topic adapter, `clearButtons`, fakes (~350);
- 1b: pure helpers, use case, join (~450);

or record `size:exception`.

## Testing Strategy (Strict TDD)

| Layer | Cases | Approach |
|---|---|---|
| Pure | `topicNameFor` (control and bidi characters, whitespace, empty ⇒ slug, 128-unit cap, no split surrogate); `topicLink` (`-100` stripping, non-`-100` ⇒ null); `parseJoinArgument` (bare, non-slug, three tokens) | Vitest |
| Use case | Non-admin or non-member changes nothing. A live topic (the post succeeds) gets `already` and nothing is created. A rejected (closed topic, no rights), unavailable or rate-limited post, or an unexpected error, is treated as unknown: no recreate, logged as `topic-check-failed`. A **deleted** topic (the post is `thread-gone`) is recreated and the stale id replaced. **Redelivery:** a second call after success returns `already`. **Concurrent taps:** a claim loss followed by a re-read gives `already` or `busy`, with exactly one `create`. Missing rights or not a forum: the claim is released and nothing is linked. `unavailable` keeps the claim. **Link failure / post failure after creation**: never throws. **Pin failure** adds a note. A button-clear failure is ignored. | `FakeForumTopicManager` (scripted outcomes, call log), plus the fake publisher and repo |
| D1 | Claim CAS on `IS NULL` and `IS stale`, TTL expiry, release, `setGeneralMessageId`; `save`/`persistAnalysis` leave the new columns alone | vitest-pool-workers |
| Adapters | Create-error classification table; `clearButtons` sends `editMessageReplyMarkup` without markup; the keyboard carries `hp:<slug>` of at most 64 bytes | Injected `Api` stub |
| Handlers | The `hp:` alert for non-admins; a private chat is ignored; the join usage; a failing safe General post never produces a 500; the consumer General post has the button, a topic post has none, and a `setGeneralMessageId` failure still acks | `telegram-stub.ts`, callback fixtures from `commands.test.ts` |

No fetch, LLM or validation path changes, so `npm run harness` is not required.

## Threat Matrix

The shell, VCS and PR rows are N/A: this change has no shell, subprocess, VCS or PR automation. The only routing change is the Telegram `hp:` callback. Its `callback_data` is untrusted: a strict slug regex, the team from the chat and never from the payload, and the admin check from `ctx.from.id`. RED tests are listed under Handlers.

## Migration / Rollout

`0004`:
- `ADD COLUMN general_message_id INTEGER`
- `ADD COLUMN topic_claim_until INTEGER NOT NULL DEFAULT 0`

Both are additive. Operator steps:
1. Apply 0004 remotely, then deploy.
2. Grant "Administrar temas".
3. Smoke test: tap the button; delete the topic and tap again (validates that a thread-gone post recreates the topic and that the description matches, and the link format); run a join on an old analysis.

Rollback: redeploy the previous Worker. The columns are ignored.

## Open Questions

- [ ] Can the spec adopt the three design-proposed strings (`createFailed`, `createUncertain`, `linkFailed`)?
- [ ] The `t.me/c` topic link and the thread-gone recreation (the exact Telegram description) are unverified against production (smoke step 3).
- [ ] Known race: a refresh job whose `persistAnalysis` upsert runs during participation can overwrite `thread_id` with its stale value. This is pre-existing behavior; recovery is `/hackathon <slug>` in the topic.
