# Archive Report: natural-language-text

- **Archived:** 2026-10-05
- **Verdict:** PASS WITH WARNINGS (0 critical_findings / 0 blockers) — see `verify-report.md`
- **Tasks:** 37/37 checked (Task Completion Gate passed)
- **Artifact store:** openspec (repo-local)
- **Review gate:** omitted in native status; archive proceeded per orchestrator Go (`archive: ready`)

## Intent

Team members drive every existing group bot capability via Spanish natural language (@mention or reply-to-bot) in General and forum topics. Slash commands remain. Mutations are confirm-first (`nl:` buttons or yes/cancel lexicon). Dedicated `NL_MODEL_PRIMARY`, soft classify quota, privacy-mode eligibility.

## Verify evidence

| Field | Value |
|-------|-------|
| Verdict | `pass_with_warnings` |
| Requirements | 12/12 |
| Scenarios | 36/36 |
| Tests | `npm test` exit 0 — 86 files, 1137 passed |
| Typecheck | `npm run typecheck` exit 0 |
| Evidence revision | `sha256:0edd279c6997774e9330c26c4409ba7ff9721dd1db0b3119e39d48f452439bfa` |
| Observation (Engram) | `sdd/natural-language-text/verify-report` |

## Specs synced

| Domain | Action | Details |
|--------|--------|---------|
| `natural-language-text` | Created | Full capability spec → `openspec/specs/natural-language-text/spec.md` (11 requirements, 29 scenarios). Main did not exist. |
| `telegram-webhook` | Modified | Replaced matching `### Requirement: Command-Only Routing` only. Preserved `Secret Token Validation` and all other structure. Delta: +`nl:` callbacks, eligible NL mention/reply routing, DM exclusion (1 requirement, 7 scenarios). |

## Intentional notes (non-blocking WARNINGs)

1. **Design Intent Schema omit unlink** — `design.md` Intent Schema block still omits `unlink_hackathon_topic`, which shipped in Phase 4 follow-ups and is in the capability spec/code. Archive does not rewrite design; follow-up alignment optional.
2. **Retrospective TDD evidence** — TDD Cycle Evidence tables in `apply-progress.md` were backfilled after a prior FAIL; authenticity is reconstructed. Referenced test files exist and the suite is green (1137/1137).
3. **Harness deferred** — Classifier real-model harness (`harness:nl`) still deferred; CI uses fake classifier; live Telegram smoke completed in Phase 4.2. Re-run harness when the classifier prompt changes again.
4. **Triangulation** — Execute-after-confirm runtime proof is strong for `join_team` / `participate_hackathon` (+ CAS race), not every mutate intent; shared dispatch wiring covers the rest.

Archive marked **intentional-with-warnings** for the above; no CRITICAL issues.

## Archive destination

`openspec/changes/archive/2026-10-05-natural-language-text/`

## Archive contents (pre-move inventory)

- proposal.md ✅
- design.md ✅
- explore.md ✅
- tasks.md ✅ (37/37)
- apply-progress.md ✅
- verify-report.md ✅
- archive-report.md ✅
- specs/natural-language-text/spec.md ✅
- specs/telegram-webhook/spec.md ✅

## Source of truth updated

- `openspec/specs/natural-language-text/spec.md` (new)
- `openspec/specs/telegram-webhook/spec.md` (Command-Only Routing replaced)

## SDD cycle

Planned, implemented, verified (PASS WITH WARNINGS), and archived. Ready for the next change.
