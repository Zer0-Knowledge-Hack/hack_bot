# Apply Progress: natural-language-text

## Current

Phase 4 operator smoke **complete**. Next: commit local advances, then verify/archive (Gentle AI review) when ready.

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
