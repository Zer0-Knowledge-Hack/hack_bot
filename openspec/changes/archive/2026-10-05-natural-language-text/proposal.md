# Proposal: Natural-Language Text Control (Spanish)

## Intent

Team members drive every existing bot capability by speaking Spanish in the group — either `@`-mentioning the bot or replying to one of its messages — in General or in a forum topic. The bot maps that text onto the current typed use cases and permission gates. Slash commands stay fully supported. Mutations never run from the model alone: the bot proposes, then the member confirms with an inline button **or** a short affirmative reply. Roadmap change 5. Voice input (6) and bot audio replies (7) will reuse the same intent pipeline later.

## Scope

### In Scope

- **Group chats only** (General and topics). No NL handling in DMs; DM team picker and DM `/profile` stay command-based.
- **Delivery triggers** (privacy mode stays on — `can_read_all_group_messages=false`):
  - a group/topic message whose text `@`-mentions the bot username from `BOT_INFO`; or
  - a reply to a message authored by the bot.
- **Full capability coverage** via a closed intent enum that maps 1:1 onto existing use cases / command paths:

  | Intent | Kind | Backing path |
  |--------|------|--------------|
  | `help` | read | dedicated help reply (new copy; lists what NL can do) |
  | `setup_team` | mutate | `setupTeam` |
  | `join_team` | mutate | `joinTeam` |
  | `bind_data_channel` | mutate | `bindDataChannel` |
  | `show_profiles` | read | `readProfiles` |
  | `set_profile_field` | mutate | `updateProfileField` (**only** when the utterance is in the bound data channel) |
  | `promote_member` | mutate | `changeRole` → admin |
  | `demote_member` | mutate | `changeRole` → member |
  | `link_repo` | mutate | `linkRepoToTopic` |
  | `unlink_repo` | mutate | `unlinkRepo` |
  | `list_repos` | read | `listRepoLinks` |
  | `list_hackathons` | read | `listAnalyses` |
  | `show_hackathon` | read | `showAnalysis` |
  | `link_hackathon_topic` | mutate | `linkAnalysisToTopic` |
  | `request_hackathon_analysis` | mutate | `requestHackathonAnalysis` |
  | `show_topic_hackathon` | read | `showTopicAnalysis` |
  | `participate_hackathon` | mutate | `participateInHackathon` |
  | `unknown` | — | short refusal + pointer to `help` |

- **Reads:** classify → fill slots → run the use case → Spanish reply (same error copy as commands).
- **Mutations (confirm-first):**
  - After a complete, authorized-looking intent, post a confirmation message naming the action and non-secret slots in Spanish.
  - Confirm via **inline button** (`nl:` callback family) **or** an affirmative **reply** to that confirmation message (closed Spanish yes-set; design lists the exact tokens, e.g. sí / si / dale / confirmo / ok).
  - Re-check actor, role, and context (thread, data channel, etc.) at confirm time — never trust the classifier for authorization.
  - One-time confirm token with TTL (design picks D1 vs KV); `callback_data` stays ≤64 bytes and carries no PII / long URLs.
- **`set_profile_field`:** NL is accepted **only inside the team's bound data channel**. In General or other topics the bot refuses with existing / new Spanish copy directing the member there. Confirmation MUST NOT echo the field value into chat.
- **`help`:** first-class intent (not folded into `unknown`).
- **Classifier model:** dedicated Worker var `NL_MODEL_PRIMARY`, separate from hackathon extraction. No fallback model var in this change. Unset → NL path fails closed with an operator-facing Spanish reply; slash commands keep working.
- **Language:** Spanish prompts, examples, and user copy. Structure the classifier I/O and copy tables so English and Portuguese can be added later without redesigning ports. Do not ship en/pt UX in this change.
- Prefilter before any AI call: drop empty/whitespace, oversize text, and non-eligible messages; strip the `@bot` mention from the classified text.
- Logging: intent id, confidence bucket, outcomes, error codes only — never full user utterance or profile values (PII posture).
- Slash commands and existing `hp:` / `sel:` callbacks remain unchanged in behavior.

### Out of Scope

- Natural language in DMs.
- Disabling Telegram privacy mode / reading all group messages.
- Voice / STT (change 6) and bot audio replies (change 7).
- New domain features beyond routing existing capabilities (no reminders, digests, multi-hackathon-per-topic, etc.).
- Shipping English or Portuguese user-facing NL.
- Changing hackathon extraction models, prompts, or `npm run harness` extraction path (except that a **new** classifier harness may be added for NL prompt work).
- Fixing deferred fresh-topic pinning.

## Capabilities

### New Capabilities

- `natural-language-text`: eligibility (mention / reply-to-bot, group only), prefilter, closed-enum classification, slot filling from text + chat context, read execution, mutate confirmation (button + affirmative reply), `help` / `unknown`, `set_profile_field` data-channel gate, confirm-token lifecycle, NL model config fail-closed, Spanish-first i18n hooks.

### Modified Capabilities

- `telegram-webhook`: route eligible group plain-text messages and `nl:` callbacks (in addition to commands and `hp:`); continue ignoring non-eligible plain text.
- Existing capability specs gain a short note that NL is an alternate trigger with the same authorization rules (no requirement rewrites unless a scenario is NL-specific).

## Approach

Follows exploration recommendation **B**.

1. Webhook / grammY handler detects eligible group messages; commands still win when the update is a bot command.
2. Domain use case (name finalized in design, e.g. `handleNaturalLanguage`) orchestrates: prefilter → `IntentClassifier` → slot resolution → read execute **or** create confirm challenge.
3. New ISP port `IntentClassifier`, implemented with Workers AI (`env.AI.run`), temperature 0, JSON schema for enum + slots — **separate** from `LlmExtractor`.
4. Confirm store + `nl:` callback handler + affirmative-reply detector on replies to bot confirmation messages.
5. Router dispatches to existing use cases only; no duplicated business rules in the adapter.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/specs/telegram-webhook` | Modified | Eligible NL messages + `nl:` callbacks |
| `openspec/specs/natural-language-text` | New | Capability spec |
| `src/domain/ports.ts`, `src/domain/errors.ts` | Modified | `IntentClassifier`, confirm-store port, errors |
| `src/domain/usecases/` | New | NL handle + confirm flows |
| `src/adapters/llm/` | New | Workers AI intent classifier adapter |
| `src/adapters/telegram/` | Modified | Message eligibility, NL router, `nl:` callbacks, copy |
| `src/adapters/d1/` (or KV) | Maybe | Confirm token persistence |
| `src/env.ts`, `wrangler.jsonc`, `.dev.vars.example` | Modified | `NL_MODEL_PRIMARY` only |
| `src/composition.ts` | Modified | Wiring |
| `migrations/` | Maybe | Confirm tokens table |
| `test/`, optional `scripts/` harness | New/Modified | Fake classifier; real-model NL harness if prompt lands |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Wrong mutate classification | Med | Confirm-first; human-readable action+slots; actor re-check |
| Affirmative-reply false positive | Med | Only replies to a live confirmation message; closed yes-lexicon; token must be pending |
| @mention delivery gaps | Med | Reply-to-bot path documented and smoked; help text teaches both triggers |
| Neuron cost from chatty mentions | Med | Prefilter; length cap; fail-fast `unknown`; optional soft daily NL cap (design) |
| Confirm token replay / redelivery | Med | One-time consume; TTL; idempotent use cases where already safe |
| Scope size (“everything”) | High | Chained PRs; closed enum; no new product features |
| PII leak via confirm / logs | Med | Data-channel-only profile set; never echo values; structured logs only |
| Unset NL model breaks UX | Low | Fail closed for NL only; commands unaffected |

## Rollback Plan

Redeploy the previous Worker. Pending confirm tokens become inert. No extraction/queue behavior changes. If a confirm-token migration was applied, it only adds a table/columns — safe to leave in place.

## Dependencies

- Archived changes 1–4 and `spanish-copy` (Spanish command copy already in tree).
- Workers AI binding (`env.AI`) already present; new model var(s) must be set for NL to answer.
- Bot privacy mode may stay enabled; operator docs should show `@mention` and reply-to-bot examples.
- Participation confirm (`hp:`) remains the path for the analysis button; NL `participate_hackathon` may reuse the same use case after its own `nl:` / reply confirm (design avoids double-confirm UX where redundant).

## Success Criteria

- [ ] In a group General and in a topic, `@mention` and reply-to-bot Spanish utterances reach the NL path; other plain text is ignored
- [ ] DMs never enter the NL path
- [ ] Every listed intent is reachable and hits the existing use case / help copy
- [ ] Reads execute without a confirm step; mutations require button **or** affirmative reply confirm
- [ ] `set_profile_field` via NL works only in the data channel and never echoes the value
- [ ] `help` returns dedicated guidance; `unknown` does not
- [ ] Unset `NL_MODEL_PRIMARY` fails NL closed without breaking slash commands
- [ ] Classifier is fakeable in `npm test`; authorization refusals match command behavior
- [ ] Domain has no grammY imports
- [ ] Production smoke: mention + reply, one read, one mutate confirm (button and reply), data-channel profile gate

## Delivery

Expect well over 400 lines. Deliver as chained PRs, for example:

1. Eligibility + webhook/spec delta + `help`/`unknown` stub (no model or fixed fake) + tests
2. `IntentClassifier` port/adapter + `NL_MODEL_PRIMARY` + read intents
3. Confirm tokens + button + affirmative-reply + mutate intents (including data-channel profile set)

## Open questions (for design)

Resolved in `design.md`:

1. Confirm tokens in **D1** (`nl_confirmations`), TTL 10 min; lookup by `(chat_id, confirm_message_id)` for reply-yes.
2. Affirmative / cancel Spanish lexicon closed-set (see design).
3. **`NL_MODEL_PRIMARY` only** this change (no fallback var yet).
4. Soft NL quota: **100 classify calls / team / UTC day**, separate from analysis quota.
5. NL participate confirms once via `nl:` / reply, then calls `participateInHackathon` directly (no second `hp:`).
6. Confidence floor **0.55**; closed JSON enum schema in design.

Remaining apply-time only: concrete Workers AI model id for `NL_MODEL_PRIMARY`.

## Proposal question round

All product decisions were resolved with the user (2026-10-05):

- Group only; no DM NL
- Confirm via inline button **and** affirmative reply
- `set_profile_field` NL only in data channel
- Dedicated `help` intent
- Dedicated NL model env var(s), not shared with extraction
