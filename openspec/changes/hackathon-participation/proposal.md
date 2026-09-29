# Proposal: Confirm Hackathon Participation and Create Its Topic

## Intent

After a General-chat analysis, the team decides whether to join. Today an admin has to create the forum topic by hand and then run `/hackathon <slug>` inside it. This change turns that decision into one admin action: the bot creates the topic, links the analysis, and pins it. It costs 0 neurons and uses the Workers Free plan only. Roadmap change 4.

## Scope

### In Scope
- A single use case, `participateInHackathon`, with two triggers:
  - an inline "✅ Participamos" button on the General analysis post (`callback_data` `hp:<slug>`, at most 64 bytes);
  - `/hackathon join <slug>` as the fallback for old analyses that have no button.
- Admins only. A non-admin tap gets a callback alert ("Only an admin can confirm participation"). The team is resolved from the chat id.
- Topic name `🏆 <name>`:
  - built from `fields.name.value`, falling back to the slug;
  - the name is untrusted page text, so strip control characters and collapse whitespace;
  - the result stays within 1–128 characters.
- Idempotency:
  - if the analysis has a live topic, create nothing and reply with the topic link;
  - if the link is stale (the topic was deleted), posting the analysis into it detects it (only a 400 that says the thread does not exist counts), the stale link is dropped, and the topic is recreated;
  - any other failure of that post (closed topic, missing rights, 5xx, 429) is inconclusive: nothing is recreated and the link is kept.
- On success:
  - post "✅ Participating in <name> → <link>" in General;
  - remove the button from the original message;
  - post and pin the analysis in the topic through the existing link+pin flow.
- Missing `can_manage_topics`, or a chat that is not a forum, gets an explicit operator reply and persists nothing.
- The General analysis post keeps its message id so the button can be attached and later removed.
- Replies are in English and plain text.

### Out of Scope
- Natural-language detection. It comes in a later change that must be confirm-first: the LLM proposes and this button confirms.
- Key-date reminders.
- A `/linkrepo` suggestion.
- Several hackathons per topic.
- Any LLM or neuron use.

## Capabilities

### New Capabilities
- `hackathon-participation`: triggers, admin gate, topic naming and sanitizing, idempotency and stale recreation, post-confirm effects, rights failures, redelivery safety.

### Modified Capabilities
- `hackathon-analysis`:
  - the General post carries the button;
  - the argument rule accepts `join <slug>`;
  - `/hackathons` output is unchanged.
- `telegram-webhook`: routes `hp:` callback queries in groups, beyond command-only routing.

`repo-topic-links` is not changed.

## Approach

This follows the exploration's recommendation, D+A.
- A new ISP port, `ForumTopicManager`, provides create, with rejections classified. The existing-topic check reuses `ChatPublisher.post`, whose adapter reports a distinct `thread-gone` failure class.
- `ChatPublisher.post` gets an optional inline keyboard, plus a way to remove it.
- `callerLocation` gets a `callback_query` variant.
- Once the topic exists, link it immediately and never rethrow. Partial failures reply with a recovery hint.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/domain/ports.ts`, `src/domain/errors.ts` | Modified | Port and errors |
| `src/domain/usecases/participate-in-hackathon.ts` | New | Use case |
| `src/domain/usecases/run-hackathon-job.ts` | Modified | General post with the button |
| `src/adapters/telegram/{chat-publisher,hackathon-commands,context}.ts` | Modified | Adapter, join, callback |
| `src/composition.ts` | Modified | Wiring |
| `migrations/0004_*.sql` | Maybe | Claim column (design decides) |

Fetch, LLM and validation are untouched, so `npm run harness` is not required.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Redelivery creates a second topic | Med | Link right after creating; no rethrow after that |
| Concurrent taps | Low | Claim migration, or accept the race (design) |
| Bot lacks topic rights | Med | Operator reply; nothing persisted |
| The check recreates a live topic | Low | Only a 400 whose description matches "message thread not found", `TOPIC_ID_INVALID` or `TOPIC_DELETED` is `thread-gone`; a closed topic or missing rights stay `rejected` and never recreate |
| A deleted topic is not recreated because Telegram words the error differently | Low | Safe side: the link is kept and `already` is returned; the Telegram smoke test verifies the wording |

## Rollback Plan

Redeploy the previous Worker. Old buttons then do nothing, and topics that were created stay in place. Any migration only adds a column.

## Dependencies

- The bot is a group admin with "Manage Topics" and "Pin Messages" (operator step).
- Change `spanish-copy` lands first. All user-facing bot text is Spanish (neutral/professional), so this change's button ("✅ Participamos"), alerts, confirmations and error replies are written in Spanish from the start. Extracted analysis field values stay in the page's language.

## Success Criteria

- [ ] An admin tap creates one topic, links and pins the analysis, posts the confirmation, and removes the button
- [ ] A non-admin gets the alert and nothing changes
- [ ] A live topic gets a link reply; a deleted topic is recreated
- [ ] A webhook redelivery never creates a second topic
- [ ] Missing rights or a non-forum chat persist nothing
- [ ] The domain has no grammY imports

## Delivery

About 350–500 lines, delivered as 2 chained PRs:
1. port + adapter + use case + `/hackathon join`;
2. button + callback + consumer wiring.

## Open questions (for design)

1. A claim migration versus accepting the concurrent-tap race.
2. The mechanism for the stale-topic check.
3. How the button is removed after a `/hackathon join`, when the General message id is unknown.

## Proposal question round

All product decisions were resolved with the user. None are open.
