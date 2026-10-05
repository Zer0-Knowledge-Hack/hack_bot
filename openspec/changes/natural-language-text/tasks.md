# Tasks: Natural-Language Text Control (Spanish)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1300 (PR1 ~350, PR2 ~450, PR3 ~500) |
| 400-line budget risk | High (aggregate); PR1 Low–Medium; PR2/PR3 Medium–High (`size:exception` likely) |
| Chained PRs recommended | Yes |
| Suggested split | PR1 eligibility + help/unknown stub → PR2 classifier + reads + quota → PR3 confirms + mutates |
| Delivery strategy | 3 chained PRs (design) |
| Chain strategy | stacked-to-main (each PR targets `main` after the previous merges) |

Decision needed before apply: No (product + design locked)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Mark PR2/PR3 as likely `size:exception` if over 400 lines.
Classifier prompt/schema work requires a real-model NL harness before merge of those edits (`npm run harness:nl` or equivalent); extraction `npm run harness` unchanged unless extraction files are touched (they should not be).
Each PR independently keeps `npm test` green. Migration 0005 is additive.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Eligibility detector, webhook/spec routing, help/unknown stub (no Workers AI), Spanish copy | PR1 (~350) | `npm test -- test/adapters/telegram test/http` | N/A | NL handler stub files |
| 2 | Migration quota table, `IntentClassifier`, `NL_MODEL_PRIMARY`, read intents, fake classifier | PR2 (~450) | `npm test -- test/domain test/adapters/llm` | `harness:nl` when prompt lands | classifier adapter + read router |
| 3 | `nl_confirmations`, button + reply confirm, mutate intents, data-channel profile gate | PR3 (~500) | `npm test -- test/domain/usecases test/adapters/telegram test/adapters/d1` | N/A unless prompt tweaks | confirm repo + mutate router |

## Phase 1: Eligibility and Stub Router (PR1)

- [x] 1.1 RED: pure tests for mention detection (case-insensitive `@username` from bot info), reply-to-bot detection, DM rejection, command exclusion, mention strip + length cap (0 and >500).
- [x] 1.2 GREEN: create `src/domain/nl/eligibility.ts` (or equivalent pure helpers).
- [x] 1.3 RED: handler/http tests — eligible General mention and topic reply-to-bot enter NL stub; plain text ignored; DM ignored; `/hackathons` does not call NL.
- [x] 1.4 RED: stub path — keyword/help heuristic or fixed stub returns dedicated `help` copy vs `unknown` copy (Spanish); catalog-language test covers new strings.
- [x] 1.5 GREEN: `src/adapters/telegram/` NL message registration (from `registerCommands` or sibling), copy entries, composition wiring with stub (no `AI.run` yet).
- [x] 1.6 GREEN: update change-local + note for `telegram-webhook` delta scenarios in tests (`nl:` not required until PR3; mention/reply routing covered).
- [x] 1.7 Run `npm test` and `npm run typecheck`; green; slash commands unchanged.

## Phase 2: Classifier, Quota, Read Intents (PR2)

- [x] 2.1 RED: `test/adapters/migrations.test.ts` — 0005 creates `nl_classify_quota` (and may create `nl_confirmations` early empty unused, or split: quota-only in 0005a — **prefer single 0005 with both tables** so PR3 needs no migration).
- [x] 2.2 GREEN: `migrations/0005_natural_language_text.sql` additive tables per design.
- [x] 2.3 RED: D1 quota tests — reserve succeeds until 100/team/UTC day; 101st false; separate from analysis quota.
- [x] 2.4 GREEN: `NlClassifyQuota` port + D1 adapter + fakes.
- [x] 2.5 RED: `IntentClassifier` adapter tests — valid JSON enum → `IntentResult`; invalid intent id / bad JSON / low confidence → `unknown` or classified error; blank `NL_MODEL_PRIMARY` → ConfigError / fail-closed path; **never logs utterance**.
- [x] 2.6 GREEN: `src/domain/ports.ts` (`IntentClassifier`, types), `src/adapters/llm/workers-ai-intent-classifier.ts` (name flexible), `env.ts` + `wrangler.jsonc` + `.dev.vars.example` for `NL_MODEL_PRIMARY`.
- [x] 2.7 RED: `handleNaturalLanguage` (name flexible) tests — quota short-circuit; missing model reply; `help` / `unknown`; read intents call existing use cases (`listAnalyses`, `showAnalysis`, `listRepoLinks`, `readProfiles`, `showTopicAnalysis`) with auth refusals unchanged.
- [x] 2.8 GREEN: domain use case + telegram adapter dispatch for reads; replace PR1 stub classifier with real port (tests use fake).
- [x] 2.9 GREEN: optional `scripts/` NL harness skeleton; document model id choice in apply-progress when selected.
- [x] 2.10 Run `npm test` and `npm run typecheck`. If classifier prompt is non-stub, run NL real-model harness and record evidence.

## Phase 3: Confirmations and Mutate Intents (PR3)

- [ ] 3.1 RED: D1 `nl_confirmations` — create, find by `(chat_id, confirm_message_id)`, `tryConsume` CAS, cancel, expiry.
- [ ] 3.2 GREEN: `NlConfirmationRepo` port + D1 adapter + fakes.
- [ ] 3.3 RED: lexicon tests — yes/cancel normalization (`sí`→`si`, accents, trailing punctuation); non-lexicon reply to confirm does not consume.
- [ ] 3.4 RED: mutate path — classification of mutate intent creates confirmation and does **not** call use case; confirm text includes `confirmHint`; profile value absent from confirm text.
- [ ] 3.5 RED: `set_profile_field` outside data channel → refuse, no confirmation; inside data channel → confirmation then `updateProfileField` on yes.
- [ ] 3.6 RED: confirm via `nl:ok` / `nl:no` callbacks; wrong actor refused; second consume noops; expired soft refusal.
- [ ] 3.6a RED: **concurrent dual confirm** — pending row; simultaneous `nl:ok` callback and affirmative reply; use case invoked at most once; loser is busy/noop after CAS.
- [ ] 3.7 RED: confirm via reply `sí` / `cancelar` to confirm message; **no classifier call**; same-actor rule.
- [ ] 3.7a RED: `promote_member` / `demote_member` slot resolution — explicit `membershipId` → confirm; reply-to-user who is a team member → that membership; missing/ambiguous → clarify, no confirmation, never guess.
- [ ] 3.7b RED: `set_profile_field` confirmation stores value only in `slots_json`; confirm/success copy and logs omit the value; after consume/cancel/expiry the row cannot be re-confirmed (TTL ≤10m assertion in D1 tests).
- [ ] 3.8 RED: each mutate intent dispatches once after confirm to the existing use case (`setupTeam`, `joinTeam`, `bindDataChannel`, `changeRole`, `linkRepoToTopic`, `unlinkRepo`, `linkAnalysisToTopic`, `requestHackathonAnalysis`, `participateInHackathon`, `updateProfileField`) with permission errors mapped like commands.
- [ ] 3.9 GREEN: `ChatPublisher` NL confirm keyboard (semantic options), `nl:` callback registration, reply-to-confirm branch before classify, copy table, composition wiring.
- [ ] 3.10 RED: http/webhook e2e — `nl:` routed; unrecognized prefix ignored; eligible NL still routed.
- [ ] 3.11 Extend catalog-language tests for all new NL strings.
- [ ] 3.12 Run `npm test` and `npm run typecheck`.

## Phase 4: Operator Step and Final Verification (after PR3)

- [ ] 4.1 Operator: apply migration 0005 remotely; set `NL_MODEL_PRIMARY` to the chosen Workers AI model id; deploy.
- [ ] 4.1a Operator note (accepted risk): confirm rows may hold short-lived plaintext profile values in D1 for ≤10 minutes; do not lengthen TTL, dump `slots_json` in logs/observability, or retain consumed rows for debugging with PII.
- [ ] 4.2 Operator smoke: `@bot ayuda` in General and a topic (using the live `BOT_INFO.username`, not a hard-coded name); reply-to-bot read; one mutate confirm via button and via `sí`; profile NL in General refused / in data channel ok without echoing value; DM not handled as NL; spot-check slash commands.
- [ ] 4.3 Run full `npm test` and `npm run typecheck`, both green.
- [ ] 4.4 If classifier prompt changed since last harness run, re-run NL harness and attach evidence before verify/archive.
