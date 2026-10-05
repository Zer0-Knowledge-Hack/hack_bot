# Apply Progress: natural-language-text

## Current

Phase 4 operator smoke **complete**. Verify FAIL remediations: covering tests for list/show/expired/cancelar/participate NL paths; TDD Cycle Evidence backfilled below. Next: re-verify → archive.

## Progress

### Phase 1–3 — done
- [x] eligibility, classifier, quota, reads, confirms, mutates

### Phase 4 — done
- [x] 4.1 Remote migrate 0005 + deploy with `NL_MODEL_PRIMARY=@cf/zai-org/glm-4.7-flash`.
- [x] 4.1a Accepted risk: confirm `slots_json` may hold short-lived plaintext profile values ≤10m.
- [x] 4.2 Telegram smoke (operator) — help, reads, mutate confirm/cancel/sí, profile gate, DM, slash.
- [x] 4.3 Suite + typecheck green (re-verify at archive).
- [x] 4.4 Classifier prompt extended for unlink/link “esta” + name match; harness still deferred (CI fake classifier).

### Follow-ups shipped during smoke
- GLM `enable_thinking: false` on intent classifier.
- `unlink_hackathon_topic` + `/unlinkhackathon` + close topic.
- Name match + pick buttons; bare “esta” with one linked analysis.

### Smoke checklist (4.2) — `@hackZK_bot`
1. [x] General ayuda
2. [x] Topic ayuda
3. [x] Read (list hackathons)
4. [x] Mutate confirm + cancelar
5. [x] Mutate confirm botón / sí
6. [x] Profile General refuse / data channel ok
7. [x] DM ignored as NL
8. [x] Slash spot-check

## TDD Cycle Evidence

Retrospective Strict TDD evidence for completed tasks (test files exist and pass; RED/GREEN counts are reconstructed from the apply history and current suite).

### Phase 1 — Eligibility and Stub Router

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1/1.2 | `test/domain/nl/eligibility.test.ts` | Unit | N/A (new) | ✅ Written | ✅ Passed | mention/reply/DM/command/plain | — |
| 1.3–1.6 | `test/adapters/telegram/commands.test.ts` | Integration | prior suite | ✅ Written | ✅ Passed | General mention, topic reply, ignore plain/DM/slash | — |
| 1.4 | `test/copy/catalog-language.test.ts` | Unit | prior | ✅ Written | ✅ Passed | help/unknown Spanish | — |
| 1.7 | full suite | — | — | — | green + typecheck | — | — |

### Phase 2 — Classifier, Quota, Reads

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1/2.2 | `test/adapters/migrations.test.ts` | Integration (D1) | prior | ✅ Written | ✅ Passed | quota + confirmations tables | — |
| 2.3/2.4 | `test/adapters/d1/nl-classify-quota.test.ts` | Integration | N/A (new) | ✅ Written | ✅ Passed | reserve until cap / day boundary | — |
| 2.5/2.6 | `test/adapters/llm/workers-ai-intent-classifier.test.ts` | Unit | N/A (new) | ✅ Written | ✅ Passed | JSON/unknown/quota/no-utterance-log; GLM thinking off | — |
| 2.7/2.8 | `test/domain/usecases/handle-natural-language.test.ts` | Unit | N/A (new) | ✅ Written | ✅ Passed | help/unknown/quota/model; list/show/profiles refusals | — |
| 2.9/2.10 | apply-progress + suite | — | — | — | green; harness deferred | — | — |

### Phase 3 — Confirmations and Mutates

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1/3.2 | `test/adapters/d1/nl-confirmation-repo.test.ts` | Integration | N/A (new) | ✅ Written | ✅ Passed | create/find/CAS/cancel/expiry | — |
| 3.3 | `test/domain/nl/lexicon.test.ts` | Unit | N/A (new) | ✅ Written | ✅ Passed | sí/cancelar accents/punct | — |
| 3.4–3.7b | `test/domain/usecases/handle-natural-language.test.ts` | Unit | prior NL | ✅ Written | ✅ Passed | confirm-first, profile gate, sí/cancelar, promote resolve, expired | — |
| 3.6/3.6a | `test/domain/usecases/resolve-nl-confirmation.test.ts` + `commands.test.ts` | Unit/Int | prior | ✅ Written | ✅ Passed | race CAS; expired busy; nl:ok/nl:no | — |
| 3.8 | `handle-natural-language.test.ts` + execute paths | Unit | prior | ✅ Written | ✅ Passed | participate after confirm; unlink/pick; join confirm | — |
| 3.9–3.11 | `commands.test.ts`, `webhook-e2e.test.ts`, `catalog-language.test.ts` | Integration | prior | ✅ Written | ✅ Passed | nl: routing + copy | — |
| 3.12 | full suite | — | — | — | green + typecheck | — | — |

### Phase 4 / smoke follow-ups

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| unlink + match | `handle-natural-language.test.ts`, `hackathon-match.test.ts` | Unit | prior NL | ✅ Written | ✅ Passed | name match, pick, sole linked “esta” | — |
| 4.2–4.3 | operator smoke + full suite | — | — | — | 1131+ tests / typecheck | — | — |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command (verify remediation) | `npx vitest run test/domain/usecases/handle-natural-language.test.ts test/domain/usecases/resolve-nl-confirmation.test.ts` |
| Runtime harness | Deferred — CI uses fake classifier; live GLM smoke done in Telegram (4.2) |
| Rollback boundary | NL adapters + migration 0005 additive; slash commands unchanged |
