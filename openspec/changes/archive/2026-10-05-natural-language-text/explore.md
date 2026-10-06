# Exploration: natural-language-text (roadmap change 5)

## Product Intent

Team members speak to the bot in Spanish (plain text) instead of memorizing slash commands. The bot maps that text onto the **existing** typed use cases and permission gates. Voice input (change 6) and bot audio replies (change 7) will feed / reuse the same intent pipeline; this change ships **text in only**.

## Decisions Locked (2026-10-05)

1. **Intent coverage:** every capability the bot already exposes via commands / callbacks — not a read-only subset.
2. **Listen surface:** General chat **and** forum topics.
3. **Delivery triggers:** a message that **@mentions** the bot, **or** a **reply** to a message the bot posted. Not free-floating chat chatter.
4. **Language:** Spanish is the production focus. The classifier and copy MUST be structured so English and Portuguese can be added later without redesigning the pipeline.

## Current State

- Slash commands are the only text entry: `/setup`, `/join`, `/datachannel`, `/profile`, `/promote`, `/demote`, `/linkrepo`, `/unlinkrepo`, `/repos`, `/hackathon`, `/hackathons`, plus `hp:` participation callbacks and DM `sel:` team picker.
- `openspec/specs/telegram-webhook` requires **command-only** routing (plus recognized callbacks). Plain text and replies are ignored today.
- `BOT_INFO.can_read_all_group_messages` is `false` (privacy mode on). Under privacy mode Telegram documents delivery of: commands, **replies to the bot**, service messages, and **messages that @mention the bot**. That matches the locked delivery model — no need to disable privacy or rely on “admin sees everything” (still unverified and unnecessary).
- Domain already has one use case per capability, with deterministic admin / membership / data-channel gates. Adapters map domain errors to Spanish copy (`spanish-copy` archived).
- Workers AI is used only for hackathon page extraction (`LlmExtractor`). There is **no** intent-classifier port yet. Extraction validation is strict (verbatim snippets); intent classification needs a **closed enum**, not free-form plans.
- Participation already established confirm-first for a dangerous side effect: LLM (or NL) proposes, button / explicit confirm executes (`participateInHackathon`).

## Capability → Intent Map

Every row must be reachable from Spanish NL in this change. Execution always goes through the named use case (or the same adapter path that commands use today).

| Intent id | Kind | Existing entry | Use case / path | Who |
|-----------|------|----------------|-----------------|-----|
| `setup_team` | mutate | `/setup` | `setupTeam` | Telegram group admin |
| `join_team` | mutate | `/join` | `joinTeam` | any user in group |
| `bind_data_channel` | mutate | `/datachannel` | `bindDataChannel` | team admin, inside a topic |
| `show_profiles` | read | `/profile show` | `readProfiles` | member; data-channel / DM rules unchanged |
| `set_profile_field` | mutate | `/profile set` | `updateProfileField` | self only |
| `promote_member` | mutate | `/promote` | `changeRole` → admin | team admin |
| `demote_member` | mutate | `/demote` | `changeRole` → member | team admin |
| `link_repo` | mutate | `/linkrepo` | `linkRepoToTopic` | team admin, inside a topic |
| `unlink_repo` | mutate | `/unlinkrepo` | `unlinkRepo` | team admin, inside a topic |
| `list_repos` | read | `/repos` | `listRepoLinks` | member |
| `list_hackathons` | read | `/hackathons` | `listAnalyses` | member |
| `show_hackathon` | read | `/hackathon <slug>` (non-admin / General) | `showAnalysis` | member |
| `link_hackathon_topic` | mutate | `/hackathon <slug>` as admin in a topic | `linkAnalysisToTopic` | team admin in topic |
| `request_hackathon_analysis` | mutate | `/hackathon <url>` | `requestHackathonAnalysis` | team admin (quota / queue) |
| `show_topic_hackathon` | read | bare `/hackathon` in a linked topic | `showTopicAnalysis` | member |
| `participate_hackathon` | mutate | button `hp:` / `/hackathon join` | `participateInHackathon` | team admin |

Slash commands remain fully supported. NL is an additional front door.

## Safety Model

### Reads

Execute immediately after classification + slot fill + the **same** deterministic authorization the command path uses. On refusal, reply with the existing Spanish copy for that error.

### Mutations

**Confirm-first.** The classifier never calls a mutating use case directly.

1. Classify → structured intent + slots (or `unknown` / `unsupported`).
2. Resolve slots from text + chat context (current `threadId`, replied-to message metadata when useful).
3. If slots are incomplete or ambiguous → ask one short clarifying question (still no side effect).
4. If complete → post a confirmation card (inline button(s) and/or explicit “confirmá con el botón”) naming the action in plain Spanish.
5. Only the callback (or an explicit confirm command if design adds one) invokes the use case.

Reuse the participation pattern: short `callback_data` prefixes, admin/actor re-checked at confirm time, best-effort acknowledge, never trust the LLM for authorization.

### Non-negotiables

- Permissions stay in domain use cases / existing gates — not in the prompt.
- Prompt injection / spoofed phrasing cannot bypass admin checks.
- PII profile fields: confirmation text MUST NOT echo secrets into General; prefer confirming field name + “valor recibido”, or require confirm in DM / data channel (design decides).
- `request_hackathon_analysis` spends neurons and quota: confirm MUST show the URL and that it counts against the daily cap.
- Unrecognized or low-confidence text → short help pointing at what the bot can do; no LLM retry storm.

## Approaches

| | A Keywords / regex only | B Prefilter + closed LLM enum | C Free-form LLM planner |
|---|---|---|---|
| Delivery | Same mention/reply handler | Same | Same |
| Coverage of “everything” | Brittle for Spanish morphology and slot extraction | Fit: one enum per intent id above | Overkill; hard to bound |
| Neurons | 0 | One cheap classify call per eligible message | Higher; plan tokens |
| Security | No model misfire; high false negatives | Enum + confirm-first | Injection → invented tools |
| Voice (change 6) | Weak shared pipeline | **Same IntentResult** after STT | Same but heavier |
| Testability | Medium | Good: fake `IntentClassifier` port | Poor |

### Recommendation

**B.** Eligible message (mention or reply-to-bot, General or topic) → cheap prefilter (ignore empties, pure noise, oversized text) → `IntentClassifier` port (Workers AI, temperature 0, JSON enum + slots) → router:

- `read` → run use case → reply
- `mutate` → confirmation UI → callback → use case
- `unknown` → help / ask clarify

Spanish prompts and few-shot examples first; keep a `locale` / language hint field so en/pt catalogs can land later without changing ports.

Skip A as insufficient for full coverage. Skip C: free-form plans fight the existing typed use-case architecture.

## Design Notes for the Proposal

### Delivery & webhook

- Extend `telegram-webhook` beyond command-only: route `message` updates that are (a) a reply to the bot’s user id, or (b) text containing `@<bot username>` (from `BOT_INFO`), in groups/topics; ignore other plain text.
- Do **not** require `can_read_all_group_messages=true`.
- Commands and existing callbacks keep priority; if a message is both a command and a mention, command handling wins (current grammY command path).
- DMs: out of scope for the first NL group slice unless design finds a cheap win; DM team picker stays as today. (Open question below.)

### Ports

- New ISP port, e.g. `IntentClassifier.classify({ text, localeHint, context }) → IntentResult`.
- `IntentResult`: `{ intent: IntentId | "unknown", confidence, slots: Record<…>, language?: "es"|"en"|"pt" }`.
- Context passed in is **non-secret structured hints only** (chat kind, whether `threadId` is set, optional replied-message kind) — never raw PII dumps or other members’ profile values.
- Separate from `LlmExtractor` (different prompt, schema, failure taxonomy).

### Confirmation callbacks

- New callback prefix family (e.g. `nl:`) distinct from `hp:` and `sel:`.
- Payload: intent id + opaque confirm token or short hashed slot bundle stored in D1/KV with TTL (design picks storage) — **do not** pack PII or long URLs into 64-byte `callback_data`.
- Actor and role re-validated on tap.

### Slot filling from context

- “Acá” / “este tema” → current `threadId` (required for `link_repo`, `bind_data_channel`, `link_hackathon_topic`).
- “Ese hackathon” while replying to an analysis message → prefer slug/url parsed from the replied bot message when present.
- Membership targets for promote/demote: explicit membership id **or** reply-to-user that maps to exactly one team membership; otherwise clarify — never guess by display name.

### Cost & models

- One Workers AI call per eligible NL message (not per every group message).
- Prefer a small/fast instruct model for classification; keep extraction models unchanged.
- Cap input length; reject oversize before calling the model.
- Log only intent id, confidence bucket, outcome codes — never full user text in production logs (align with PII posture); design may allow truncated hash or length only.

### i18n posture

- Runtime copy stays Spanish (existing `copy.ts`).
- Classifier prompt: Spanish-primary instructions + Spanish examples; document extension points for en/pt synonym lists and prompt sections.
- Do not ship en/pt UX in this change.

### Testing

- Unit: router, confirm gate, slot resolution, webhook eligibility (mention vs reply vs neither).
- Fake `IntentClassifier` in Vitest — no neurons in `npm test`.
- Real-model harness (project rule) only for classifier prompt/schema changes, analogous to `npm run harness` for extraction.
- Production smoke: reply-to-bot and @mention in General and in a topic.

### PR shape (size)

Expect >400 lines. Suggest chained PRs, e.g.:

1. Webhook eligibility + stub router (unknown → help) + tests.
2. `IntentClassifier` port/adapter + read intents.
3. Confirm-token storage + mutate intents + callbacks.

## Affected Areas

- `openspec/specs/telegram-webhook` (routing rules)
- New capability spec `natural-language-text` (or `nl-intents`)
- Possibly small deltas on existing capability specs (NL as alternate trigger)
- `src/domain/ports.ts`, new usecase(s) e.g. `interpret-user-utterance` / `confirm-nl-action`
- `src/adapters/llm/` (classifier adapter)
- `src/adapters/telegram/` (message handler, confirm callbacks, copy)
- `src/composition.ts`, `wrangler` model id config
- Optional migration for confirm tokens
- Tests + optional harness script

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| @mention not delivered in some clients / privacy edge cases | Med | Reply-to-bot is the reliable path; document both; smoke both |
| Classifier maps to wrong mutate intent | Med | Confirm-first; show human-readable action+slots before execute |
| Neuron spend from chatty mentions | Med | Prefilter; length cap; unknown short-circuits; daily soft quota (design) |
| Confirm callback replay | Med | One-time token TTL; idempotent use cases where they already are |
| PII in confirm messages | Med | Confirm in place without echoing values; or restrict profile NL to data channel / DM |
| Scope blow-up (“everything”) | High | Chained PRs; one enum; no new domain features beyond routing |

## Open Questions for Proposal

Resolved with the user (2026-10-05):

1. **DMs:** group-only for change 5 (no NL in private chat).
2. **Confirm UX:** inline buttons **and** affirmative reply to the confirmation message.
3. **Profile set via NL:** only inside the bound data channel (not General / other topics / DM).
4. **Help intent:** dedicated `help` enum value.
5. **Classifier model id:** dedicated env var(s) (e.g. `NL_MODEL_PRIMARY`), not shared with extraction.

## Ready for Proposal

Yes — approach **B**, full existing capability coverage, mention + reply delivery in General and topics, Spanish-first with en/pt extension hooks. Product questions above are locked; remaining items are design-time.
