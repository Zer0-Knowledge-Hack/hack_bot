# Apply Progress: natural-language-text

## Current

Phase 2 (PR2 classifier + reads + quota) **complete**. Next: Phase 3 (confirms + mutates).

## Progress

### Phase 1 — done
- [x] 1.1–1.7 eligibility helpers, NL stub handler, Spanish `nlCopy`, tests, full suite + typecheck green

### Phase 2 — done
- [x] 2.1–2.10 migration 0005, `NlClassifyQuota`, `IntentClassifier`, `handleNaturalLanguage` reads, wire `NL_MODEL_PRIMARY`, replace stub, tests

### Notes
- `registerNaturalLanguage` after slash commands; `next()` when ineligible.
- `NL_MODEL_PRIMARY`: `@cf/zai-org/glm-4.7-flash` (Free-plan; same family as hackathon primary until harness evidence).
- Mutate intents reply with deferred copy until PR3.
- Optional `harness:nl` deferred (CI uses fake classifier; 0 neurons).
- Verification: `npm test` 1089 passed + `npm run typecheck` green (2026-10-05).
