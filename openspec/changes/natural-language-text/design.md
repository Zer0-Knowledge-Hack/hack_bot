# Design: Natural-Language Text Control (Spanish)

## Technical Approach

Hexagonal, same as changes 3–4. One orchestrating use case, `handleNaturalLanguage`, sits in front of the **existing** typed use cases. A thin grammY adapter admits only group messages that `@`-mention the bot or reply to a bot message (General or topic). Classification goes through a new ISP port `IntentClassifier` (Workers AI, Spanish-primary, closed enum). Reads execute immediately. Mutations create a pending confirmation; the member finishes with an `nl:` inline button **or** an affirmative reply to that confirmation message. Confirm time re-runs the real use case with the same permission gates commands use today. Domain never imports grammY. Specs: new `natural-language-text`, plus a `telegram-webhook` delta.

## Architecture Decisions

| # | Topic | Choice | Rejected (tradeoff) |
|---|---|---|---|
| 1 | Delivery | Privacy mode stays on. Eligible iff (group/supergroup, not DM) **and** (text contains `@<BOT_INFO.username>` case-insensitive **or** `reply_to_message.from.id === bot.id`). Commands still take the grammY command path first. | Disable privacy / read all messages: unnecessary cost and PII surface. Rely on “admin sees everything”: unverified and broader than needed. |
| 2 | Classifier port | New `IntentClassifier.classify(input) → IntentResult`. Separate from `LlmExtractor` (different prompt, schema, failures). Adapter uses `env.AI.run` with `NL_MODEL_PRIMARY`. | Reusing `LlmExtractor`: would conflate page-JSON extraction with intent enums. Free-form planner: invents tools and bypasses typed use cases. |
| 3 | Confirm storage | **D1 table** `nl_confirmations` (migration 0005). No KV binding exists today; D1 matches the rest of the bot. Row keyed by `id` (UUID). Also indexed by `(chat_id, confirm_message_id)` so an affirmative **reply** resolves the pending challenge. TTL **10 minutes** (`expires_at`). Consume is CAS: `UPDATE … SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at > ?now`. | KV: extra binding and ops. Packing slots into `callback_data`: 64-byte limit and PII risk. |
| 4 | Confirm UX | Confirmation message carries one primary button (`nl:ok:<id8>`) and optional cancel (`nl:no:<id8>`). `callback_data` holds only the prefix + first 8 hex chars of the token id (≤64 bytes); full UUID is looked up via prefix + chat scope, or store `id` as 22-char url-safe id. Affirmative **reply** to `confirm_message_id` with a closed lexicon also consumes. Cancel lexicon or `nl:no` marks consumed without executing. | “Any reply means yes”: too loose. Second `hp:` button for participate after NL confirm: double-confirm UX. |
| 5 | Participate via NL | After a successful NL confirm for `participate_hackathon`, call `participateInHackathon` **directly** (same as `/hackathon join`). Do not re-issue the General `hp:` button. | Chaining into `hp:`: two confirms for one intent. |
| 6 | Profile set venue | Adapter/use-case gate: `set_profile_field` is only offered when `threadId === team.dataTopicThreadId`. Otherwise reply with data-channel guidance and **do not** create a confirmation. Confirm text names the field only — never the value. | General with redacted value: still easy to leak via reply quotes / screenshots of the original utterance. |
| 7 | Models | Required `NL_MODEL_PRIMARY` Worker var. **No** `NL_MODEL_FALLBACK` in this change (add later if production quality needs it). Blank/unset ⇒ NL path replies “no configurado” and does not call AI; slash commands unaffected. | Sharing `HACKATHON_MODEL_*`: couples quotas and prompt tuning. Shipping fallback now: extra config surface before we have classifier harness evidence. |
| 8 | Soft NL quota | **Yes.** Per-team daily counter in D1 (`nl_classify_quota`, UTC day), default **100** successful classify calls per team per day (constant in domain; not a Worker var unless ops asks). Enforced **before** the AI call. Cap reply is Spanish and non-secret. Separate from hackathon analysis quota. | No cap: a mention loop burns Free-plan neurons. Sharing analysis quota: punishes `/hackathon <url>` unfairly. |
| 9 | Confidence | Model returns `confidence` ∈ [0,1]. If missing, non-finite, or `< 0.55` ⇒ treat as `unknown`. Adapter validates enum membership; unknown intent ids ⇒ `unknown`. | Asking the model to refuse in prose: untestable. |
| 10 | Help vs unknown | `help` is a first-class intent with dedicated copy (what triggers NL, example phrases, pointer that `/` commands still work). `unknown` is a short “no te entendí” + suggest asking for help. | Folding help into unknown: weaker UX and harder to test. |
| 11 | Promote/demote target | Resolve `membershipId` from an explicit id in the utterance **or** from a reply-to-user whose Telegram user maps to exactly one team membership. Otherwise clarify; never guess by display name alone. | Fuzzy name match: ambiguous and spoofable. |

## Intent Schema

```ts
type NlIntentId =
  | "help"
  | "setup_team"
  | "join_team"
  | "bind_data_channel"
  | "show_profiles"
  | "set_profile_field"
  | "promote_member"
  | "demote_member"
  | "link_repo"
  | "unlink_repo"
  | "list_repos"
  | "list_hackathons"
  | "show_hackathon"
  | "link_hackathon_topic"
  | "request_hackathon_analysis"
  | "show_topic_hackathon"
  | "participate_hackathon"
  | "unknown";

type NlSlots = {
  slug?: string;
  url?: string;
  repo?: string;           // owner/repo
  membershipId?: string;
  profileField?: "full_name" | "emails" | "social_links" | "github_username";
  profileValue?: string;   // never logged; never shown in confirm text
  targetName?: string;     // display hint for promote/demote clarify only
};

interface IntentClassifierInput {
  text: string;            // mention stripped, length-capped
  localeHint: "es";        // fixed for this change; en/pt later
  context: {
    inTopic: boolean;
    inDataChannel: boolean;
    // Structured only — no message bodies, no PII dumps
    replyKind?: "bot-analysis" | "bot-confirm" | "bot-other" | "user" | "none";
  };
}

interface IntentResult {
  intent: NlIntentId;
  confidence: number;
  slots: NlSlots;
}
```

Temperature `0`. `max_tokens` sized for a small JSON object (design implementation target ≤400). Prompt: Spanish instructions + few-shot examples per intent; output **only** JSON. Parse failures / model errors ⇒ domain maps to user “no pude interpretar” without retry storms (single attempt this change).

## Eligibility and Prefilter

1. Ignore DMs and non-text messages.
2. Ignore if not (mention ∪ reply-to-bot).
3. If the message is a bot command (`/`…), leave it to existing handlers (do not also classify).
4. Strip `@username` tokens for the bot; collapse whitespace; reject if remaining length is 0 or `> 500` characters.
5. If the message is a reply to a **pending** confirmation and matches the yes/cancel lexicon → confirm path (**no** classify call).
6. Else reserve NL quota → classify → route.

## Affirmative / Cancel Lexicon (Spanish)

Normalized: trim, lowercase, strip diacritics for matching (`sí`→`si`), allow optional trailing `!` / `.`.

**Yes (exact token after normalize):** `si`, `dale`, `confirmo`, `ok`, `okay`, `de acuerdo`, `va`, `claro`.

**Cancel:** `no`, `nop`, `cancelar`, `cancel`, `mejor no`.

Anything else as a reply to a confirmation ⇒ short hint (“respondé *sí* o *cancelar*, o usá el botón”) without consuming the token (unless design later chooses to consume on garbage — **do not**; keep pending until TTL).

## Use Case Step Order

### `handleNaturalLanguage`

1. Resolve team from `chatId`; missing team ⇒ ignore or short “grupo no registrado” (match command posture for unknown groups — prefer silent ignore for non-members noise; design: if no team, ignore).
2. Resolve membership; non-member ⇒ existing not-member copy.
3. If reply-to-confirm: branch to `resolveNlConfirmation` (below) and return.
4. Prefilter; on reject, return without AI.
5. `nlQuota.reserve(teamId, day)` false ⇒ cap copy.
6. `intentClassifier.classify(...)`. On infra/config error ⇒ configured/failure copy; do not throw to webhook 500 when avoidable (log + reply).
7. If `help` ⇒ help copy. If `unknown` or low confidence ⇒ unknown copy.
8. Slot resolution from text + context (`threadId` for “acá”, data-channel flag, optional slug/url from replied analysis message when `replyKind=bot-analysis` — adapter may pass **already-extracted** slug/url hints in context extensions without raw body logging). For `promote_member` / `demote_member`, apply decision 11 (explicit id or reply-to-user membership only).
9. Incomplete slots ⇒ one clarifying question (no confirm row).
10. `set_profile_field` outside data channel ⇒ refuse (no confirm).
11. Read intents ⇒ dispatch to existing use case → `replyText`.
12. Mutate intents ⇒ `createConfirmation` → post confirm message with buttons → store `confirm_message_id` → return (no side effect yet).

### `resolveNlConfirmation` / `confirmNaturalLanguage`

1. Load pending row by `(chatId, confirmMessageId)` or by callback token id.
2. Expired / missing / consumed ⇒ soft “ya no hay nada que confirmar”.
3. Actor must be the **same membership** that requested (or design alternative: any admin for admin-only intents — **choice: same actor only**, simpler and safer against “confirm someone else’s promote”).
4. Cancel ⇒ consume, reply cancelled.
5. Yes ⇒ CAS consume; if lost, busy/noop.
6. Re-load slots from stored JSON; re-check gates; call the target use case; map errors like command adapters.

Stored slot JSON **may** include `profileValue` ciphertext-at-rest is unnecessary if the row TTL is short and table access is Worker-only — still: never log it; prefer storing profile values only encrypted if easy, else accept short-lived plaintext in D1 with TTL (document in threat matrix). **Choice:** store plaintext slots in D1 with 10 min TTL; do not log row contents; delete/consume ASAP.

## Data Flow

```
group text
  ├─ command? ──────────────────────────→ existing command handlers
  ├─ reply to pending confirm + lexicon → resolveNlConfirmation → use case
  └─ mention | reply-to-bot
        → prefilter → nlQuota → IntentClassifier
        → help | unknown | clarify
        → read  → existing use case → reply
        → mutate → insert nl_confirmations → post confirm + nl: buttons
              ├─ tap nl:ok / nl:no
              └─ reply sí / cancelar
                    → CAS consume → existing use case → reply
```

## Interfaces / Contracts

```ts
interface IntentClassifier {
  classify(input: IntentClassifierInput, signal: AbortSignal): Promise<IntentResult>;
  // throws IntentClassificationError | ConfigError | LlmQuotaExceededError (reuse or NL-specific)
}

interface NlConfirmationRepo {
  create(row: NlConfirmation): Promise<void>;
  findByConfirmMessage(chatId: number, confirmMessageId: number): Promise<NlConfirmation | null>;
  findById(id: string): Promise<NlConfirmation | null>;
  tryConsume(id: string, now: number): Promise<boolean>;
  cancel(id: string, now: number): Promise<boolean>; // consume without execute
}

interface NlClassifyQuota {
  reserve(teamId: TeamId, dayUtc: string, now: number): Promise<boolean>;
}

interface NlConfirmation {
  id: string;
  teamId: TeamId;
  chatId: number;
  threadId: number | null;
  actorMembershipId: MembershipId;
  intent: Exclude<NlIntentId, "help" | "unknown">;
  slotsJson: string;           // serialized NlSlots
  confirmMessageId: number | null; // set after post
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
}
```

`ChatPublisher.post` may gain optional NL confirm keyboard options (semantic: `nlConfirmId`) analogous to `participateSlug` — adapter owns labels and `nl:` encoding.

## Copy Table (Spanish; spec strings authoritative later)

| Key | Notes |
|---|---|
| `help` | How to @mention / reply; example phrases; commands still work |
| `unknown` | No te entendí + pedí ayuda |
| `clarify(slotsMissing)` | One short question |
| `confirmPrompt(actionSummary)` | “¿Confirmás …?” + button labels Confirmar / Cancelar |
| `confirmHint` | “También podés responder *sí* o *cancelar* a este mensaje.” |
| `confirmedBusy` | Ya se usó o expiró |
| `cancelled` | Listo, cancelé la acción. |
| `notConfigured` | NL no configurado (missing model) |
| `classifyFailed` | No pude interpretar ahora |
| `quota` | Límite diario de mensajes en lenguaje natural |
| `profileDataChannelOnly` | Pedí el cambio de perfil en el canal de datos |
| `wrongActor` | Solo quien pidió la acción puede confirmar |
| Affirmative lexicon | as above (not user-visible catalog entries) |

Read/mutate success and refusal strings reuse existing command/domain copy wherever possible.

## File Changes and PR Split

| PR | Scope | Est. |
|---|---|---|
| **1** Eligibility + help/unknown stub | `telegram-webhook` delta; mention/reply detector; ignore DM; prefilter; fixed `help` when text matches a tiny keyword list OR stub classifier returning `unknown`/`help` only; tests | ~350 |
| **2** Classifier + reads | `IntentClassifier` port/adapter; `NL_MODEL_PRIMARY`; `nl_classify_quota` + migration piece; read intents dispatch; fake classifier tests; optional NL harness script | ~450 |
| **3** Confirms + mutates | `nl_confirmations` table; confirm post + `nl:` callbacks + reply lexicon; all mutate intents including data-channel profile set; participate → `participateInHackathon` | ~500 |

`sdd-tasks` should keep each apply slice near the 400-line review budget or record `size:exception` with chaining.

Migration **0005** (single migration for PRs 2–3, applied before NL deploy):

```sql
-- nl_confirmations: id, team_id, chat_id, thread_id, actor_membership_id,
-- intent, slots_json, confirm_message_id, expires_at, consumed_at, created_at
-- UNIQUE(chat_id, confirm_message_id) WHERE confirm_message_id IS NOT NULL
-- INDEX(team_id, expires_at)

-- nl_classify_quota: team_id, day_utc, count  PRIMARY KEY(team_id, day_utc)
```

## Testing Strategy (Strict TDD)

| Layer | Cases |
|---|---|
| Pure | Mention strip; eligibility; lexicon normalize (sí/si, accents); intent JSON parse / confidence gate |
| Use case | Member/non-member; help/unknown; read dispatch; mutate creates confirm and does not call use case; confirm yes executes once; second yes noops; cancel; expired; wrong actor; profile outside data channel refused; quota exhausted skips AI |
| D1 | Confirm CAS consume; lookup by message id; quota reserve at boundary |
| Adapter | Classifier schema validation; model id from `NL_MODEL_PRIMARY`; no utterance in logs |
| Handlers | DM ignored; non-mention ignored; command not double-handled; `nl:` callback; reply-yes / reply-cancel; missing model fail-closed |

`npm test` uses a fake classifier (0 neurons). A new `npm run harness:nl` (or flag on existing harness) is required only when changing the classifier prompt/schema (project real-model rule). Extraction harness unchanged.

## Threat Matrix

| Surface | Trust | Controls |
|---|---|---|
| Group text | Untrusted | Eligibility gate; length cap; closed enum; auth in use cases; no log of raw text |
| Classifier output | Untrusted | Enum allowlist; confidence floor; slots type-checked; never authorization source |
| `nl:` callback_data | Untrusted | Strict regex; team from chat; actor must match pending row; one-time CAS |
| Affirmative reply | Untrusted | Must reply to confirm message; lexicon; same actor; CAS |
| `slots_json` in D1 | Sensitive short-lived | TTL ≤10m; plaintext `profileValue` accepted for this change; never log; never echo in confirm/success copy; consume/cancel/expiry ends usability; operator note in Phase 4 |
| Model prompt | Includes user text | Ephemeral to Workers AI; not written to app logs |

## Migration / Rollout

1. Apply migration 0005 remotely.
2. Set `NL_MODEL_PRIMARY` (Free-plan-capable instruct model; pick at apply time from current Workers AI catalog — document the chosen id in apply-progress).
3. Deploy Worker.
4. Smoke (production group):
   - `@bot ayuda` in General and in a topic
   - reply-to-bot read (`list_hackathons`)
   - mutate confirm via button and via `sí`
   - `set_profile` NL in General → refused; in data channel → confirm without echoing value
   - DM plain text → ignored by NL
5. Slash commands regression spot-check.

Rollback: redeploy previous Worker; table rows ignored.

## Sequence (confirm mutate)

```
User ─@bot “participemos en <slug>”→ Adapter → handleNaturalLanguage
  → classify participate_hackathon
  → NlConfirmationRepo.create
  → post “¿Confirmás participar en <slug>?” + [Confirmar][Cancelar]
User ─reply “sí”─→ resolveNlConfirmation → tryConsume → participateInHackathon → reply
```

## Open Questions

- [ ] Exact Workers AI model id for `NL_MODEL_PRIMARY` (catalog pick at apply / harness time).
- [x] Clarifying questions are always confirm-exempt (no pending row).
- [x] Promote/demote target: reply-to-user **or** explicit membership id; otherwise clarify — never guess (locked; mirrored in spec + tasks).

## Ready for Specs / Tasks

Done: `specs/natural-language-text/spec.md`, `specs/telegram-webhook/spec.md` (delta), and `tasks.md` (3 chained PRs + operator phase).
