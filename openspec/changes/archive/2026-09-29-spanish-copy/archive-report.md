# Archive Report: spanish-copy

- **Archived:** 2026-09-29
- **Verdict:** PASS WITH WARNINGS, no blockers (see verify-report.md)
- **Delivered in:** PR #39 (hackathon copy), PR #40 (profile/team/repo commands and team picker), PR #41 (GitHub alerts and final verification)

## Intent

All bot-authored, user-facing Telegram text is neutral Spanish (tuteo). Page-derived analysis values stay verbatim. The LLM prompt, code, identifiers, logs and log codes stay in English.

## Specs merged

- **New main spec:** `openspec/specs/bot-copy/spec.md` (5 requirements).
- **Modified main spec:** `openspec/specs/hackathon-analysis/spec.md`. Its 8 MODIFIED requirement blocks were replaced in place, and the quoted copy is now Spanish. The total stays at 12 requirements, and the delta's "(Previously: …)" annotations were not carried over.

## Implementation

- Two copy catalogs: `src/domain/copy.ts` (domain) and `src/adapters/telegram/copy.ts` (adapter). The adapter catalog imports the domain one, never the reverse.
- Exhaustive typed maps cover roles, fetch-failure kinds, GitHub alert headers and field labels.
- A language guard, `test/copy/catalog-language.test.ts`, fails if either catalog contains common English words.
- Final state: 870 tests passing, typecheck clean, 24/24 tasks checked.

## Follow-ups

- W1–W3 from the verify report are non-blocking.
- Change `hackathon-participation` (roadmap change 4) depended on this change and is now unblocked. Its copy is Spanish from the start.
