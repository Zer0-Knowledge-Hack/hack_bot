# Apply Progress: Hackathon Analysis with Slugs and Optional Topic Pinning

## Scope of this batch

Phase 1 only — Domain Foundation, Pure Modules (PR1). Phases 2-11 are untouched.

## Completed Tasks

- [x] 1.1 RED: `test/domain/hackathon/argument.test.ts`
- [x] 1.2 GREEN: `src/domain/hackathon/argument.ts`
- [x] 1.3 RED: `test/domain/hackathon/url.test.ts`
- [x] 1.4 GREEN: `src/domain/hackathon/url.ts`
- [x] 1.5 RED: `test/domain/hackathon/slug.test.ts`
- [x] 1.6 GREEN: `src/domain/hackathon/slug.ts`
- [x] 1.7 RED: `test/domain/hackathon/extraction.test.ts`
- [x] 1.8 GREEN: `src/domain/hackathon/extraction.ts`
- [x] 1.9 RED/GREEN: `src/domain/hackathon/suggest.ts`
- [x] 1.10 RED/GREEN: `src/domain/hackathon/format.ts`
- [x] 1.11 RED/GREEN: `src/domain/text-limit.ts`

All 11 Phase 1 tasks complete. Phases 2-11 remain pending (not assigned to this batch).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1/1.2 | `test/domain/hackathon/argument.test.ts` | Unit | N/A (new) | Written, confirmed failing (module not found) | 2/2 passed | 5 cases (dot, colon, empty-string edge cases added) | None needed — 21-line pure function |
| 1.3/1.4 | `test/domain/hackathon/url.test.ts` | Unit | N/A (new) | Written, confirmed failing | 13/13 passed after one fix (utm_ prefix matching) | 13 cases across guard reasons + normalization | None needed |
| 1.5/1.6 | `test/domain/hackathon/slug.test.ts` | Unit | N/A (new) | Written, confirmed failing | 9/9 passed | 9 cases (NFKD, cap, collapse, attempt boundaries) | None needed |
| 1.7/1.8 | `test/domain/hackathon/extraction.test.ts` | Unit | N/A (new) | Written, confirmed failing | 6/6 passed | 6 cases (shape reject, unparseable, null-over-guess, oversized snippet, non-verbatim snippet) | None needed |
| 1.9 | `test/domain/hackathon/suggest.test.ts` | Unit | N/A (new) | Written, confirmed failing | 4/4 passed | 4 cases (ranking, cap at 3, empty result, determinism) | None needed |
| 1.11 | `test/domain/text-limit.test.ts` | Unit | N/A (new) | Written, confirmed failing | 4/4 passed | 4 cases (fits, empty, truncates, pathological no-line-fits) | None needed |
| 1.10 | `test/domain/hackathon/format.test.ts` | Unit | N/A (new) | Written, confirmed failing | 7/7 passed | 7 cases (fields present/absent, suggestions, 4096 cap, list with/without entries, truncation) | None needed |

### Test Summary
- **Total tests written**: 48 (Phase 1 domain tests)
- **Total tests passing**: 48/48
- **Layers used**: Unit (48)
- **Approval tests** (refactoring): None — all new files
- **Pure functions created**: `classifyHackathonArgument`, `assertSafeUrl`, `normalizeUrlKey`, `deriveBaseSlug`, `slugForAttempt`, `validateExtraction`, `suggestRepos`, `formatAnalysis`, `formatHackathonsList`, `joinLinesWithinLimit`

## Work Unit Evidence

| Work unit | Focused test command | Result | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 1.1/1.2 argument classifier | `npx vitest run test/domain/hackathon/argument.test.ts` | 5/5 passed | N/A — pure Vitest | delete `src/domain/hackathon/argument.ts`, `test/domain/hackathon/argument.test.ts` |
| 1.3/1.4 URL guard + normalize | `npx vitest run test/domain/hackathon/url.test.ts` | 13/13 passed | N/A — pure Vitest | delete `src/domain/hackathon/url.ts`, `test/domain/hackathon/url.test.ts` |
| 1.5/1.6 slug derivation | `npx vitest run test/domain/hackathon/slug.test.ts` | 9/9 passed | N/A — pure Vitest | delete `src/domain/hackathon/slug.ts`, `test/domain/hackathon/slug.test.ts` |
| 1.7/1.8 extraction validator | `npx vitest run test/domain/hackathon/extraction.test.ts` | 6/6 passed | N/A — pure Vitest | delete `src/domain/hackathon/extraction.ts`, `test/domain/hackathon/extraction.test.ts` |
| 1.9 repo suggestions | `npx vitest run test/domain/hackathon/suggest.test.ts` | 4/4 passed | N/A — pure Vitest | delete `src/domain/hackathon/suggest.ts`, `test/domain/hackathon/suggest.test.ts` |
| 1.11 text-limit helper | `npx vitest run test/domain/text-limit.test.ts` | 4/4 passed | N/A — pure Vitest | delete `src/domain/text-limit.ts`, `test/domain/text-limit.test.ts` |
| 1.10 format module | `npx vitest run test/domain/hackathon/format.test.ts` | 7/7 passed | N/A — pure Vitest | delete `src/domain/hackathon/format.ts`, `test/domain/hackathon/format.test.ts` |

Full-suite and typecheck evidence (after all 7 commits):
- `npx vitest run` → 45 files, 392 tests passed (0 failed)
- `npm run typecheck` → clean, no errors

## Files Changed

| File | Action | What was done |
|------|--------|----------------|
| `src/domain/hackathon/argument.ts` | Created | Classifies a bare `/hackathon` argument as slug or URL |
| `src/domain/hackathon/url.ts` | Created | SSRF-style guard (scheme/userinfo/port/IP-literal/single-label/private-suffix) and normalization key |
| `src/domain/hackathon/slug.ts` | Created | Base slug derivation (NFKD, 40-char cap) and collision-suffix attempts |
| `src/domain/hackathon/extraction.ts` | Created | Strict schema validation of the LLM's extracted fields, null-over-guess, bounded verbatim snippet |
| `src/domain/hackathon/suggest.ts` | Created | Deterministic token-overlap repo suggestions, top 3 |
| `src/domain/hackathon/format.ts` | Created | Plain-text formatting for a stored analysis and the `/hackathons` listing |
| `src/domain/text-limit.ts` | Created | `joinLinesWithinLimit` — generalized from the existing `/repos` truncation pattern |
| `test/domain/hackathon/*.test.ts` | Created | 41 tests covering the 6 hackathon domain modules |
| `test/domain/text-limit.test.ts` | Created | 4 tests for the shared truncation helper |
| `openspec/changes/hackathon-analysis/tasks.md` | Modified | Phase 1 tasks marked `[x]` |

## Deviations from Design

- **Snippet cap**: the task doc says "snippet ≤160 verbatim"; the llm-extraction spec says "at most 200 characters." Implemented per the spec (200), since specs are the acceptance criteria of record. The 160-char figure is used only in the test's "long snippet" case to prove the cap fires below 200.
- No other deviations. `assertSafeUrl`'s IP/private-suffix coverage matches the page-fetch spec's named scenarios (loopback, RFC1918, link-local/metadata `169.254.x.x`) plus design.md's "single-label and private suffixes" categories; DNS rebinding remains an accepted residual risk per design.md's Threat Matrix (this module only inspects the literal string/hostname, as domain code must).

## Issues Found

None.

## Remaining Tasks (not in this batch)

- [ ] Phase 2: Ports, Errors, `analyzeHackathon` (PR2)
- [ ] Phase 3: `requestHackathonAnalysis` + `runHackathonJob` (PR3)
- [ ] Phase 4: Show, Link, List Use Cases (PR4)
- [ ] Phase 5: Migration + D1 Repos (PR5)
- [ ] Phase 6: Static Fetcher (PR6)
- [ ] Phase 7: Rendered (Browser) Fetcher (PR7)
- [ ] Phase 8: Workers AI Extractor + GitHub Metadata (PR8)
- [ ] Phase 9: Queue Adapter, Consumer Wiring, Handler Tests (PR9)
- [ ] Phase 10: Publisher, Commands, Env, Wrangler (PR10)
- [ ] Phase 11: Operator Rollout (manual, not performed by apply)

## Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main, per tasks.md's Chain strategy)
- Current work unit: PR1 (Phase 1 — Domain Foundation)
- Boundary: starts from a clean `feat/hackathon-domain` branch off `main` (post-PR#19 merge); ends with all 7 hackathon domain modules created, Phase 1 tasks marked `[x]`, full suite and typecheck green.
- Estimated review budget impact: **exceeds the 400-line guard**. `git diff --stat main` reports 882 insertions + 11 deletions (tasks.md checkbox edits) = 893 changed lines, well above the forecast's ~350 estimate and the 400-line budget. This is reported as-is per the instruction to flag but not self-split; the maintainer should decide whether to split this PR further or accept it with `size:exception`.

## Status

11/11 Phase 1 tasks complete. Ready for `sdd-verify` on this slice, or for the next `sdd-apply` batch (Phase 2) once PR1 is reviewed/merged per the stacked-to-main chain strategy.
