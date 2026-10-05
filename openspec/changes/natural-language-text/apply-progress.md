# Apply Progress: natural-language-text

## Current

Phase 3 (confirms + mutates) **complete**. Next: Phase 4 operator apply/smoke (or commit Phase 3 first).

## Progress

### Phase 1–2 — done
- [x] eligibility, classifier, quota, read intents

### Phase 3 — done
- [x] 3.1–3.12 confirmations, mutate path, `nl:` callbacks, lexicon replies, promote/demote slot resolution, dual-confirm race, webhook e2e

### Notes
- Confirm TTL 10m; `NL_MODEL_PRIMARY=@cf/zai-org/glm-4.7-flash`.
- Verification: `npm test` + `npm run typecheck` green (2026-10-05).
