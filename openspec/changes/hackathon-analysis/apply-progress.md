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

## PR1 correction (frozen ledger fixes, reviewed at HEAD 233852f)

One correction transaction applied against the ledger findings corroborated for `feat/hackathon-domain`. Strict TDD followed for each fix: RED (new/rewritten test, confirmed failing) → GREEN (implementation) → full-suite/typecheck confirmation.

| Finding | RED evidence | GREEN evidence |
|---|---|---|
| **RISK-002** — trailing root dot (`localhost.`, `foo.localhost.`, `metadata.google.internal.`) bypassed `assertSafeUrl` | Added 4 tests to `test/domain/hackathon/url.test.ts` (`localhost.` refused, private-suffix-with-dot refused, public-host-with-dot still accepted, plus the RISK-003 case below). `npx vitest run test/domain/hackathon/url.test.ts test/domain/hackathon/extraction.test.ts` → 3 of the 4 new URL cases failed (`ok: true` returned instead of the expected refusal) before the fix | Stripped one trailing `.` from `hostname` in `assertSafeUrl` before the localhost/IP-literal, single-label, and private-suffix checks. Re-ran the same command → all 27 tests in both files passed |
| **RISK-003** — `0.0.0.0` allowed through `isUnsafeIpv4` | Added `refuses the 0.0.0.0 unspecified address` test | Added `if (a === 0) return true;` (refuse the whole `0.0.0.0/8` block) ahead of the existing loopback/RFC1918 checks in `isUnsafeIpv4`. Confirmed green in the same run above |
| **RELI-001 / RESI-001** — `validateExtraction` did not check `candidate.value` against each field's declared type (string teamSize, numeric name, `undefined` value all passed as `ok: true`) | Added 3 tests to `test/domain/hackathon/extraction.test.ts` (string `teamSize`, numeric `name`, `undefined` value) — all 3 failed pre-fix (returned `ok: true` with the bad value stored instead of `invalid-shape`) | Added `hasValidFieldType(name, value)` — `teamSize` must be a finite `number`; every other field must be a `string` — and folded it into the existing shape guard so any field failing type-check rejects the **whole response** as `invalid-shape`, consistent with the file's existing "invalid shape rejects the whole response" semantics (kept, did not switch to per-field null) |
| **RELI-002** — the "snippet exceeds limit" test used a 197-char snippet that was also not verbatim on the page, so it passed for the wrong reason; title said 160 instead of 200 | Rewrote the test with a snippet that IS verbatim in `pageText` and is exactly 201 chars (asserted `toHaveLength(201)` and `pageText.includes(over)` before the behavioral assertion), renamed to "exceeds 200 characters"; added a new boundary test asserting an exactly-200-char verbatim snippet is kept, not nulled | Both tests passed immediately against the existing `sanitizeField` (`field.snippet.length > SNIPPET_MAX` with `SNIPPET_MAX = 200`) — no production change was needed for RELI-002, only the test rewrite, confirming the length guard was already correct and the old test was a false positive |

### Full-suite and typecheck evidence (after all 3 correction commits)
- `npx vitest run` → 45 files, **400/400 tests passed** (0 failed)
- `npm run typecheck` → clean, no errors

### Diff scope (`git diff --stat 233852f`)
```
src/domain/hackathon/extraction.ts       |  14 ++++-
src/domain/hackathon/url.ts              |   6 +-
test/domain/hackathon/extraction.test.ts | 104 +++++++++++++++++++++++++++++--
test/domain/hackathon/url.test.ts        |  26 ++++++++
4 files changed, 143 insertions(+), 7 deletions(-)
```

### Deviations
None. RELI-001/RESI-001 kept the file's existing "invalid shape rejects the whole response" semantics rather than introducing a new per-field null path, per the instruction to follow the file's existing design unless it clearly says otherwise.

## Phase 2 (PR2: Ports, Errors, analyzeHackathon) — branch `feat/hackathon-analyze-usecase`

### Scope of this batch

Phase 2 only — Ports, Errors, `analyzeHackathon` use case. Phases 3-11 are untouched. Branch created from `main` right after PR #20 (Phase 1) was merged.

### Completed Tasks

- [x] 2.1 Ports added to `src/domain/ports.ts`: `PageFetcher`, `LlmExtractor`, `HackathonAnalysisRepo`, `AnalysisQuota`, `AnalysisJobRepo`, `AnalysisJobQueue`, `RepoMetadataSource`, `ChatPublisher`.
- [x] 2.2 Entities added to `src/domain/entities.ts`: `HackathonAnalysis`, `AnalysisJobMessage`, `AnalysisJob`, `AnalysisJobStatus`, `NewAnalysisJob`, `ClaimResult`, `JobOutcome`.
- [x] 2.3 Errors added to `src/domain/errors.ts`: `UnsafeUrlError`, `PageFetchFailedError`, `PageTooThinError`, `ExtractionFailedError`, `LlmQuotaExceededError`, `QueueSendFailedError`, `AnalysisBusyError`, `DailyCapReachedError`, `AnalysisNotFoundError`, `PublishFailedError`, `BrowserQuotaExceededError`. `ConfigError` re-exported (not duplicated) from the pre-existing `src/config-error.ts`.
- [x] 2.4 Fakes added to `test/fakes/index.ts` for every new port (`fakePageFetcher`, `fakeLlmExtractor`, `fakeHackathonAnalysisRepo`, `fakeAnalysisQuota`, `fakeAnalysisJobRepo`, `fakeAnalysisJobQueue`, `fakeRepoMetadataSource`, `fakeChatPublisher`).
- [x] 2.5 RED: `test/domain/usecases/analyze-hackathon.test.ts` — 9 tests across 4 groups: static-then-browser fallback below 800 chars, 429-degrade path (both scenarios), primary-then-fallback LLM call, persist+suggestions (including slug-collision and same-URL-refresh wiring).
- [x] 2.6 GREEN: `src/domain/usecases/analyze-hackathon.ts`.

All 6 Phase 2 tasks complete. Phases 3-11 remain pending (not assigned to this batch).

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.5/2.6 | `test/domain/usecases/analyze-hackathon.test.ts` | Unit | N/A (new) | Written, confirmed failing (`Cannot find module '.../analyze-hackathon'`) | 9/9 passed after one fixture fix (the `VALID_RAW` fixture's `snippet: "Meridian"` was not verbatim in any fake page text, so `validateExtraction`'s snippet-verbatim guard nulled the field; changed to `snippet: ""`, always verbatim) | 9 cases: fallback triggered vs skipped on the 800-char threshold, 429-degrade with >=200 vs <200 static chars, primary-only vs primary-then-fallback LLM calls, fresh persist+suggestions, slug-collision suffix, same-URL refresh keeps slug/id/threadId | None needed — single orchestration function plus 3 small private helpers (`resolvePageText`, `extractFields`, `deriveUniqueSlug`), no duplication to remove |

#### Test Summary
- **Total tests written**: 9 (Phase 2 `analyzeHackathon` tests)
- **Total tests passing**: 9/9
- **Layers used**: Unit (9)
- **Approval tests** (refactoring): None — new file
- **Pure/orchestration functions created**: `analyzeHackathon`, `resolvePageText`, `extractFields`, `deriveUniqueSlug`

### Work Unit Evidence

| Work unit | Focused test command | Result | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 2.1-2.3 ports/entities/errors | `npm run typecheck` (no dedicated test file — pure type additions consumed by 2.5/2.6's tests) | Clean, no errors | N/A — type-only additions, no runtime behavior | revert commit `a9676ae` (`src/domain/{ports,entities,errors}.ts`) |
| 2.4 fakes | `npm run typecheck` (fakes are exercised transitively by 2.5/2.6's tests) | Clean, no errors | N/A — in-memory test fixtures | revert commit `a05ee2e` (`test/fakes/index.ts`) |
| 2.5/2.6 analyzeHackathon | `npx vitest run test/domain/usecases/analyze-hackathon.test.ts` | 9/9 passed | N/A — pure Vitest with fakes (no D1/Workers AI/Browser Rendering/queue calls) | revert commit `7474d52` (`src/domain/usecases/analyze-hackathon.ts`, `test/domain/usecases/analyze-hackathon.test.ts`, tasks.md checkboxes) |

Full-suite and typecheck evidence (after all 3 commits):
- `npx vitest run` → 46 files, **411/411 tests passed** (0 failed)
- `npm run typecheck` → clean, no errors
- `rg -n "workers-ai|puppeteer|grammy|cloudflare:workers|@cloudflare/puppeteer|D1Database" src/domain` → no matches (domain stays framework-free)

### Files Changed

| File | Action | What was done |
|------|--------|----------------|
| `src/domain/ports.ts` | Modified | Added `PageFetcher`, `LlmExtractor`, `HackathonAnalysisRepo`, `AnalysisQuota`, `AnalysisJobRepo`, `AnalysisJobQueue`, `RepoMetadataSource`, `ChatPublisher` |
| `src/domain/entities.ts` | Modified | Added `HackathonAnalysis`, `AnalysisJobMessage`, `AnalysisJob`, `AnalysisJobStatus`, `NewAnalysisJob`, `ClaimResult`, `JobOutcome` |
| `src/domain/errors.ts` | Modified | Added the 11 new hackathon error classes; re-exported the existing `ConfigError` |
| `test/fakes/index.ts` | Modified | Added 8 fake factories, one per new port |
| `src/domain/usecases/analyze-hackathon.ts` | Created | `analyzeHackathon` use case |
| `test/domain/usecases/analyze-hackathon.test.ts` | Created | 9 tests across the 4 scenario groups named in task 2.5 |
| `openspec/changes/hackathon-analysis/tasks.md` | Modified | Phase 2 tasks 2.1-2.6 marked `[x]` |

### Deviations from Design

- **`RepoMetadataSource` defined but not wired into `analyzeHackathon` yet.** design.md's Data Flow line reads `... → validate → repoLinks+metadata → suggest → persist+mark`, suggesting GitHub repo metadata enriches the suggestion step. Task 2.5's named test scenarios (the acceptance criteria for this batch) do not include a metadata-enrichment case, and the concrete adapter (`src/adapters/github/repo-metadata.ts`) is explicitly scoped to PR8 in design.md's File Changes table. Implemented the port interface now (task 2.1 requires it) but left `analyzeHackathon`'s suggestion step as token-overlap only (`suggestRepos` over `RepoTopicLinkRepo.list`), with a code comment pointing at this note. Wiring `RepoMetadataSource` into `analyzeHackathon` (or a documented decision that it belongs elsewhere, e.g. `showAnalysis`) is deferred to whichever PR actually implements the adapter.
- **`RepoMetadataSource`'s method shape (`fetchDescription(repo): Promise<string | null>`) is inferred**, not copied from an explicit contract in design.md (the design doc says these ports are "unchanged" from an earlier draft not included in this excerpt). Kept minimal and adjustable — no caller depends on its exact shape yet.
- **Random hex slug suffix (attempt 100+) uses the injected `IdGen`, not `crypto.randomUUID()` directly.** design.md says slug.ts "never calls crypto directly" and the caller supplies the random hex; using the already-injected `IdGen` (rather than a raw global) keeps `analyzeHackathon` fully deterministic under test. Not covered by a RED test (unrealistic to collide 99 times for one team); noted as an untested branch.
- **`analyzeHackathon` does not re-run `assertSafeUrl`.** Per design.md, the guard runs at the producer (`requestHackathonAnalysis`, PR3) and again inside each fetcher adapter on every redirect/sub-request (PR6/PR7). `analyzeHackathon` receives an already-guarded `sourceUrl` and does not duplicate the guard — consistent with task 2.5's scenario list, which does not name a guard test for this use case.
- No other deviations. Ports, entities and errors match every name listed in tasks.md 2.1-2.3.

### Issues Found

None.

### Remaining Tasks (not in this batch)

- [ ] Phase 3: `requestHackathonAnalysis` + `runHackathonJob` (PR3)
- [ ] Phase 4: Show, Link, List Use Cases (PR4)
- [ ] Phase 5: Migration + D1 Repos (PR5)
- [ ] Phase 6: Static Fetcher (PR6)
- [ ] Phase 7: Rendered (Browser) Fetcher (PR7)
- [ ] Phase 8: Workers AI Extractor + GitHub Metadata (PR8)
- [ ] Phase 9: Queue Adapter, Consumer Wiring, Handler Tests (PR9)
- [ ] Phase 10: Publisher, Commands, Env, Wrangler (PR10)
- [ ] Phase 11: Operator Rollout (manual, not performed by apply)

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main, per tasks.md's Chain strategy)
- Current work unit: PR2 (Phase 2 — Ports, Errors, analyzeHackathon)
- Boundary: starts from `feat/hackathon-analyze-usecase`, branched off `main` right after PR1 (#20) merged; ends with the 8 new ports, 7 new entity types, 11 new error classes, 8 new fakes and the `analyzeHackathon` use case all in place, Phase 2 tasks marked `[x]`, full suite and typecheck green.
- Estimated review budget impact: **exceeds the 400-line guard**, same as PR1. `git diff --shortstat main` reports 871 insertions + 7 deletions = 878 changed lines (src: 472, test: 393+1, openspec/tasks.md: 6+6), well above the forecast's ~350 estimate. Reported as-is per the instruction to flag but not self-split; the maintainer should decide whether to split this PR further or accept it with `size:exception`.

### Status

6/6 Phase 2 tasks complete (17/56 cumulative across Phases 1-2, counting each Phase 1/2 checkbox once). Ready for `sdd-verify` on this slice, or for the next `sdd-apply` batch (Phase 3) once PR2 is reviewed/merged per the stacked-to-main chain strategy.

## PR2 correction (one transaction, review at `e5b59df`)

A 4R review found three severe issues; the orchestrator confirmed each with a runtime probe before fixing.

| Finding | Problem | Fix | RED → GREEN |
|---|---|---|---|
| RISK-001 | An empty snippet passed the verbatim rule, and `value` had no length bound (a 100,000-char value was kept) | A non-empty trimmed snippet is required, and string values are capped; either violation nulls the field | `4ff97ea` |
| RELI-001 | 10 of 11 invented snippets validated as ok with 0 non-null fields, so the fallback never ran | `validateExtraction` reports `rejectedCount`; the fallback runs when more than half the fields are rejected; there are at most 2 calls | `e271f4a` |
| RESI-001 | Neither the ports nor the use case had a deadline, so "fallback only if ≥ 50 s remain" could not be enforced | `deadlineAt` (epoch ms) is added to the input. `PageFetcher.fetch` and `LlmExtractor.extract` take an `AbortSignal` capped at min(step cap, time left): static 10 s, rendered 45 s, LLM 45 s. With less than 50 s left, the fallback is skipped and `ExtractionFailedError("timeout")` is raised | 2 RED (the timeout case and the signals) → GREEN; the 50 s boundary test passed before and after (`e440479`) |

The sub-agent stalled after the first two commits. The orchestrator finished RESI-001 inline in the same transaction.

Evidence: `npx vitest run` → 46 files, 422/422 passed. `npm run typecheck` is clean.

Warnings recorded but not fixed here: RISK-002 (`save` has no explicit teamId guard), RELI-002/003/004/006 (missing boundary and keep-prior tests), RELI-005 (RepoMetadataSource wiring deferred to PR8), RESI-002 (the slug fallback at attempt 100 skips `slugExists`).

## Phase 3 (PR3: requestHackathonAnalysis + runHackathonJob) — branch `feat/hackathon-job-usecases`

### Scope of this batch

Phase 3 only — `requestHackathonAnalysis` (producer) and `runHackathonJob` (consumer). Phases 4-11 are untouched. Branch created from `main` right after PR #21 (Phase 2) was merged.

### Completed Tasks

- [x] 3.1 RED: `test/domain/usecases/request-hackathon-analysis.test.ts` — admin gate (both scenarios), busy refusal, cap-reached refusal, enqueue failure refunds.
- [x] 3.2 GREEN: `src/domain/usecases/request-hackathon-analysis.ts`.
- [x] 3.3 RED: `test/domain/usecases/run-hackathon-job.test.ts` — terminal no-op ack, held claim retries, persisted job only posts, stale job refunded, claimed happy path, transient error retries then fails on the final attempt.
- [x] 3.4 GREEN: `src/domain/usecases/run-hackathon-job.ts`.

All 4 Phase 3 tasks complete. Phases 4-11 remain pending (not assigned to this batch).

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1/3.2 | `test/domain/usecases/request-hackathon-analysis.test.ts` | Unit | N/A (new) | Written with the implementation temporarily moved aside; confirmed failing (`Cannot find module '.../request-hackathon-analysis'`); implementation restored | 5/5 passed on first run | 5 cases: admin succeeds, non-admin refused, busy refused, cap-reached refused, enqueue-failure refunds | None needed — single orchestration function, one small `utcDayOf` helper |
| 3.3/3.4 | `test/domain/usecases/run-hackathon-job.test.ts` | Unit | N/A (new) | Written, confirmed failing (`Cannot find module '.../run-hackathon-job'`) | 6/6 passed on first run | 6 cases: terminal ack, held retry, persisted-only-post, stale-refunded, claimed happy path, transient retry-then-final-fail | None needed — `runClaimedJob`/`postPersistedResult`/`classifyJobError`/`handleJobError`/`safePost` are already small single-purpose helpers |

#### Test Summary
- **Total tests written**: 11 (5 + 6)
- **Total tests passing**: 11/11
- **Layers used**: Unit (11)
- **Approval tests** (refactoring): None — both files are new
- **Functions created**: `requestHackathonAnalysis`, `utcDayOf`; `runHackathonJob`, `postPersistedResult`, `runClaimedJob`, `classifyJobError`, `handleJobError`, `safePost`

### Work Unit Evidence

| Work unit | Focused test command | Result | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 3.1/3.2 requestHackathonAnalysis | `npx vitest run test/domain/usecases/request-hackathon-analysis.test.ts` | 5/5 passed | N/A — pure Vitest with fakes (no D1/queue) | revert commit `9990c8e` (`src/domain/usecases/request-hackathon-analysis.ts`, its test, tasks.md checkboxes) |
| 3.3/3.4 runHackathonJob | `npx vitest run test/domain/usecases/run-hackathon-job.test.ts` | 6/6 passed | N/A — pure Vitest with fakes (no D1/Workers AI/Browser Rendering/queue/Telegram) | revert commit `9ca5741` (`src/domain/usecases/run-hackathon-job.ts`, its test, tasks.md checkboxes) |

Full-suite and typecheck evidence (after both commits):
- `npx vitest run` → 48 files, **433/433 tests passed** (0 failed)
- `npm run typecheck` → clean, no errors

### Files Changed

| File | Action | What was done |
|------|--------|----------------|
| `src/domain/usecases/request-hackathon-analysis.ts` | Created | `requestHackathonAnalysis` — admin gate, atomic cap+lease reservation, enqueue, ack reply; refunds on enqueue failure |
| `test/domain/usecases/request-hackathon-analysis.test.ts` | Created | 5 tests across the named scenarios |
| `src/domain/usecases/run-hackathon-job.ts` | Created | `runHackathonJob` — claim dispatch (terminal/held/persisted/claimed), stale-job refund, 180 s attempt deadline via `analyzeHackathon`, error-taxonomy classification (permanent vs transient), post + terminal mark + quota release |
| `test/domain/usecases/run-hackathon-job.test.ts` | Created | 6 tests across the named scenarios plus one happy-path wiring test |
| `openspec/changes/hackathon-analysis/tasks.md` | Modified | Phase 3 tasks 3.1-3.4 marked `[x]` |

### Deviations from Design

- **`runHackathonJob`'s `attempt` parameter is the queue's own delivery counter, not `AnalysisJob.attempts`.** design.md's "Interfaces / Contracts" names the signature `runHackathonJob(msg, attempt, deps)` without spelling out what `attempt` is. `AnalysisJob.attempts` is D1-maintained and incremented by `claim`; using it directly would require an extra D1 round trip inside a pure use case just to read the pre-claim value. Using the queue's own attempt count for the transient-retry limit keeps the function pure and matches "max_retries: 2" (3 total attempts) at the queue-consumer boundary named in design.md's "Retries" row. Noted here for `src/index.ts` (PR9) to wire from the real `Message.attempts`.
- **A fresh (non-stale, non-erroring) `/hackathon <url>` run is always posted via `chatPublisher.post` directly — never through `linkAnalysisToTopic`.** design.md's Data Flow line groups "general chat: publisher.post" and "topic: linkAnalysisToTopic (post, pin, moveLink, unpin old)" under the same consumer step, but `linkAnalysisToTopic` is explicitly scoped to PR4 (tasks.md Phase 4) and does not exist yet. The spec's own named scenario for a fresh run ("Admin runs a fresh analysis in general chat") only requires an unpinned post; no fresh-run scenario in the hackathon-analysis spec requires pinning. Task 3.3/3.4's scenario list (the acceptance criteria for this batch) also never names a link/pin case. Wiring `runHackathonJob` to call `linkAnalysisToTopic` instead of a bare `post` when `job.threadId` is set is deferred to whichever PR actually implements and wires that use case (PR4 or later), with a decision to make at that point about whether fresh-run topic posts should also pin.
- **`postPersistedResult` recomputes the stored analysis from `job.fetchUrl` via `normalizeUrlKey` + `HackathonAnalysisRepo.findByNormalizedUrl`, since the repo has no `findById`.** This matches design.md's own stated pattern ("the consumer recomputes the key from `fetchUrl` with the same pure function") and reuses the exact port shape already defined in PR2 without adding a new method to `HackathonAnalysisRepo`. If no analysis is found (should not happen in practice once a job reaches `persisted`), the post is skipped rather than throwing, and the job is still marked succeeded and released — a defensive fallback, not a named scenario.
- **A `ConfigError` refunds the reserved cap slot; every other permanent job error does not.** design.md's Error Taxonomy table has "No (refund)" in the Cap column for `ConfigError` specifically, versus a bare "Yes"/"No" for the other rows — read as "counts against the cap: no, because it is refunded" (a misconfiguration is never a real run). No RED test in this batch drives the `ConfigError` branch (task 3.3's named scenarios do not include it); the classification exists for completeness with the design table and will be exercised once an adapter that can throw `ConfigError` is wired (PR8/PR10).
- **A failure reply that itself fails to send is swallowed (`safePost`), not re-classified.** Re-entering `classifyJobError` on a failed failure-reply would risk infinite loops between "post the error" and "the post itself errored." design.md's Error Taxonomy row for `PublishFailedError rejected` says "(none possible)" for the user reply, implying failure-reply delivery is already understood to be best-effort at this layer.

### Issues Found

None.

### Remaining Tasks (not in this batch)

- [ ] Phase 4: Show, Link, List Use Cases (PR4)
- [ ] Phase 5: Migration + D1 Repos (PR5)
- [ ] Phase 6: Static Fetcher (PR6)
- [ ] Phase 7: Rendered (Browser) Fetcher (PR7)
- [ ] Phase 8: Workers AI Extractor + GitHub Metadata (PR8)
- [ ] Phase 9: Queue Adapter, Consumer Wiring, Handler Tests (PR9)
- [ ] Phase 10: Publisher, Commands, Env, Wrangler (PR10)
- [ ] Phase 11: Operator Rollout (manual, not performed by apply)

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main, per tasks.md's Chain strategy)
- Current work unit: PR3 (Phase 3 — requestHackathonAnalysis + runHackathonJob)
- Boundary: starts from `feat/hackathon-job-usecases`, branched off `main` right after PR2 (#21) merged; ends with both use cases in place, Phase 3 tasks marked `[x]`, full suite and typecheck green.
- Estimated review budget impact: **exceeds the 400-line guard**, same as PR1/PR2. `git diff --shortstat main` reports src: 342 insertions (2 files), test: 334 insertions (2 files), openspec: 4+4 = 680 changed lines total, above the forecast's ~380 estimate. Reported as-is per the instruction to flag but not self-split; the maintainer should decide whether to split this PR further or accept it with `size:exception`.

### Status

4/4 Phase 3 tasks complete (23/56 cumulative across Phases 1-3, counting each checkbox once). Ready for `sdd-verify` on this slice, or for the next `sdd-apply` batch (Phase 4) once PR3 is reviewed/merged per the stacked-to-main chain strategy.

## PR3 correction (reviewed at HEAD `250d3e0`)

One correction transaction applying four corroborated findings from the post-apply review of PR3. Findings RISK-001, RELI-004, RELI-005 are deferred (out of scope).

### RESI-001 — post failure reply before marking terminal

**Problem**: `handleJobError` and the stale-job path did `markFailed` → `release` → `safePost`. A crash after `markFailed` leaves the job terminal, so redelivery acks silently and the reply is lost.

**RED** (`test/domain/usecases/run-hackathon-job.test.ts`): added two tests — stale-job and permanent-failure paths — each overriding `analysisJobRepo.markFailed` to throw, asserting `chatPublisher.posted` already has 1 entry despite the throw propagating.
```
npx vitest run test/domain/usecases/run-hackathon-job.test.ts
Tests  2 failed | 6 passed (8)
  stale job: posts the expiry reply before marking failed ... — expected [] to have length 1
  permanent failure: posts the failure reply before marking failed ... — expected [] to have length 1
```

**GREEN**: reordered both paths in `src/domain/usecases/run-hackathon-job.ts` to `safePost` → `markFailed` → `release` (mirrors the success path's post-then-mark, design.md "Post then mark ... never silence").
```
npx vitest run test/domain/usecases/run-hackathon-job.test.ts
Tests  8 passed (8)
```
Commit: `11d2cc3 fix(hackathon-job): post failure reply before marking terminal (RESI-001)`

### RESI-002 — enqueue-failure cleanup is best-effort

**Problem**: in `requestHackathonAnalysis`'s enqueue-failure catch, if `markFailed` or `release` threw, the original `QueueSendFailedError` was lost and the slot could stay reserved (the un-run `release` never executed).

**RED** (`test/domain/usecases/request-hackathon-analysis.test.ts`): two tests — `markFailed` throws (assert `release` still called with `refund: true`, original error rethrown); `release` throws (assert `markFailed` was still called, original error rethrown).
```
npx vitest run test/domain/usecases/request-hackathon-analysis.test.ts
Tests  2 failed | 5 passed (7)
  enqueue failure: markFailed throwing still releases the slot ... — expected error to be instance of QueueSendFailedError, got plain Error
  enqueue failure: release throwing still rethrows the original error ... — same
```

**GREEN**: wrapped `markFailed` and `release` each in their own try/catch (swallow-and-continue) in `src/domain/usecases/request-hackathon-analysis.ts`, then always `throw err` (the original `QueueSendFailedError`).
```
npx vitest run test/domain/usecases/request-hackathon-analysis.test.ts
Tests  7 passed (7)
```
Commit: `8c1e983 fix(request-hackathon-analysis): make enqueue-failure cleanup best-effort (RESI-002)`

### RELI-002 — repost the persisted analysis by id, fail loudly if missing

**Problem**: `postPersistedResult` re-derived the analysis by normalized URL instead of `job.analysisId`; a lookup miss silently skipped the post but still called `markSucceeded`.

**RED** (`test/domain/usecases/run-hackathon-job.test.ts`): new test — persisted job with `analysisId: "analysis-missing"` and no matching row — asserts a failure reply is posted, `succeeded` stays empty, and `failed` records `job:missing-analysis`.
```
npx vitest run test/domain/usecases/run-hackathon-job.test.ts
Tests  1 failed | 8 passed (9)
  persisted claim with a missing analysis: posts a failure reply ... — expected [] to have length 1
```

**GREEN**:
- Added `findById(teamId, id)` to `HackathonAnalysisRepo` (`src/domain/ports.ts`, TeamId-first per the port convention) and to its fake (`test/fakes/index.ts`).
- `postPersistedResult` now looks up `deps.hackathonAnalysisRepo.findById(job.teamId, job.analysisId)`; on a miss it treats this as a permanent failure using the RESI-001 post-then-mark ordering (post failure reply, `markFailed("job:missing-analysis")`, `release(..., refund: false)`) instead of marking success.
```
npx vitest run test/domain/usecases/run-hackathon-job.test.ts
Tests  9 passed (9)
```
Commit: `d94fe46 fix(hackathon-job): repost persisted analysis by id, fail loudly if missing (RELI-002)`

### RELI-001 — spec text alignment (docs only, no code change)

**Problem**: `openspec/changes/hackathon-analysis/specs/hackathon-analysis/spec.md`'s "Duplicate delivery" scenario said a job in a "persisted or terminal state" MUST NOT be posted again, contradicting the approved design's accepted one-post-duplicate crash window (design.md "Post then mark").

**Fix**: reworded the requirement paragraph and the "Duplicate delivery" scenario to state the guaranteed behavior — terminal-state redelivery acks with no second cap/LLM/post; persisted-state redelivery skips fetch+LLM and only reposts, and the design accepts that this repost can happen once after a crash.
Commit: `4de2867 docs(hackathon-analysis): align duplicate-delivery spec with post-then-mark design`

### RELI-003 — tracking only (docs)

Added `tasks.md` item 4.6: wire `linkAnalysisToTopic` into `runHackathonJob`'s fresh-completion path when `job.threadId` is not null (design.md: "a `/hackathon <url>` run inside a topic links and pins from the consumer"). No code change in this batch — `linkAnalysisToTopic` itself is Phase 4 (PR4), not yet implemented.
Commit: `27f251f docs(hackathon-analysis): track linkAnalysisToTopic wiring into run-hackathon-job (RELI-003)`

### Deferred (not in scope for this correction)

RISK-001, RELI-004, RELI-005 — left untouched per instruction.

### Full-suite evidence (after all four fixes)

```
npx vitest run
Test Files  48 passed (48)
     Tests  438 passed (438)

npm run typecheck
> tsc --noEmit
(no errors, exit 0)
```

### Diff vs `250d3e0`

```
git diff --stat 250d3e0
 .../specs/hackathon-analysis/spec.md               | 12 ++---
 openspec/changes/hackathon-analysis/tasks.md       |  1 +
 src/domain/ports.ts                                |  4 ++
 src/domain/usecases/request-hackathon-analysis.ts  | 17 ++++++-
 src/domain/usecases/run-hackathon-job.ts           | 44 ++++++++++++------
 .../usecases/request-hackathon-analysis.test.ts    | 36 +++++++++++++++
 test/domain/usecases/run-hackathon-job.test.ts     | 54 ++++++++++++++++++++++
 test/fakes/index.ts                                |  2 +
 8 files changed, 149 insertions(+), 21 deletions(-)
```
(apply-progress.md itself changed after this diff snapshot was taken; the commit below adds it.)

## PR3 extra fix (authorized by the maintainer after scoped validation escalated)

The scoped validator escalated **FIXV-001**. The RESI-001 and RESI-002 fixes swallowed failures in bare `catch {}` blocks whose comments claimed "logged by the adapter layer", but neither use case received a `Logger`, so those failures were invisible.

- **Fix**: `logger: Logger` is added to `RunHackathonJobDeps` and `RequestHackathonAnalysisDeps`.
  - `safePost` logs `{ event: "hackathon-job", outcome: "error", reason: "failure-reply-failed" }`.
  - The enqueue cleanup logs `{ event: "hackathon-enqueue-cleanup", outcome: "error", reason: "mark-failed-failed" | "release-failed" }`.
  - Only the error class name goes into `errorCode`, never the message.
  - The shared fakes gain `fakeLogger()`.
- **RED**: 3 failing tests (the two RESI-002 cleanup tests now also assert the log entry, plus a new one where the failure reply cannot be sent). **GREEN**: 439/439 pass, and the typecheck is clean.

## Phase 4 (PR4: Show, Link, List Use Cases + 4.6) — branch `feat/hackathon-show-link-list`

### Scope of this batch

Phase 4 only — `showAnalysis`, `linkAnalysisToTopic`, `listAnalyses`, and task 4.6 (wiring `linkAnalysisToTopic` into `runHackathonJob`'s fresh-completion path). Phases 5-11 are untouched. Branch created from `main` right after PR #22 (Phase 3 + PR3 corrections) was merged.

### Completed Tasks

- [x] 4.1 RED: `test/domain/usecases/show-analysis.test.ts` — re-show by slug free of cap, not-found error.
- [x] 4.2 GREEN: `src/domain/usecases/show-analysis.ts`.
- [x] 4.3 RED: `test/domain/usecases/link-analysis-to-topic.test.ts` — link into empty topic, move-link + unpin old on both conflict directions, pin-failure fallback.
- [x] 4.4 GREEN: `src/domain/usecases/link-analysis-to-topic.ts`.
- [x] 4.5 RED/GREEN: `test/domain/usecases/list-analyses.test.ts` + `src/domain/usecases/list-analyses.ts`.
- [x] 4.6 Wired `postAnalysisAndLinkTopic` into `runHackathonJob`'s fresh-completion path when `job.threadId` is not null (RELI-003).

All 6 Phase 4 tasks complete (29/56 cumulative across Phases 1-4). Phases 5-11 remain pending (not assigned to this batch).

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1/4.2 | `test/domain/usecases/show-analysis.test.ts` | Unit | N/A (new) | Written, confirmed failing (`Cannot find module '.../show-analysis'`) | 3/3 passed on first run | 3 cases: any-member re-show, not-found, non-member actor | None needed |
| 4.3/4.4 | `test/domain/usecases/link-analysis-to-topic.test.ts` | Unit | N/A (new) | Written, confirmed failing (`Cannot find module '.../link-analysis-to-topic'`) | 5/7 passed first run (2 failures were the test's own lowercase "replaced"/"moved" assertions vs the implementation's capitalized wording — fixed the test, not the implementation); 7/7 after | 7 cases: empty-topic link, topic-holds-different-analysis, analysis-linked-elsewhere, pin-failure fallback, not-found, non-admin, non-member | None needed — `postAnalysisAndLinkTopic` extracted as the permission-free core up front (needed for 4.6), not as a later refactor |
| 4.5 | `test/domain/usecases/list-analyses.test.ts` | Unit | N/A (new) | Written, confirmed failing (`Cannot find module '.../list-analyses'`) | 3/3 passed on first run | 3 cases: field mapping (name/deadline/linked), truncation past 4096 with a "...and N more" note, non-member actor | None needed |
| 4.6 | `test/domain/usecases/run-hackathon-job.test.ts` (added case) | Unit | Full existing 10-test file (regression) | Added "claimed job inside a topic: links and pins instead of a bare post"; confirmed failing (`pinned` array empty — bare `post` was still used) | 11/11 passed after wiring `postAnalysisAndLinkTopic` into `runClaimedJob`'s happy path (only when `job.threadId !== null`) | Existing general-chat happy-path test (`threadId: null`) re-run unchanged — proves the `null` branch still uses a bare post | None needed |

#### Test Summary
- **Total tests written**: 18 (3 + 7 + 3 + 1 new case in an existing file, plus 2 pre-existing analyze-hackathon.test.ts assertions updated for the new `pinnedMessageId` field)
- **Total tests passing**: 453/453 (full suite)
- **Layers used**: Unit (18)
- **Approval tests** (refactoring): None — new files, and run-hackathon-job.ts's existing tests all still pass unchanged
- **Functions created**: `showAnalysis`; `linkAnalysisToTopic`, `postAnalysisAndLinkTopic`, `safeUnpin`; `listAnalyses`

### Work Unit Evidence

| Work unit | Focused test command | Result | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 4.1/4.2 showAnalysis | `npx vitest run test/domain/usecases/show-analysis.test.ts` | 3/3 passed | N/A — pure Vitest with fakes | revert commit `b5b9a67` (`src/domain/usecases/show-analysis.ts`, its test, `entities.ts`'s `pinnedMessageId` field, `analyze-hackathon.ts`'s persist line, 2 pre-existing test literals, tasks.md checkboxes) |
| 4.3/4.4 linkAnalysisToTopic | `npx vitest run test/domain/usecases/link-analysis-to-topic.test.ts` | 7/7 passed | N/A — pure Vitest with fakes (no D1/Telegram) | revert commit `098d70f` (`src/domain/usecases/link-analysis-to-topic.ts`, its test, `ports.ts`'s `findByThreadId`, the fake, tasks.md checkboxes) |
| 4.5 listAnalyses | `npx vitest run test/domain/usecases/list-analyses.test.ts` | 3/3 passed | N/A — pure Vitest with fakes | revert commit `fba8e40` (`src/domain/usecases/list-analyses.ts`, its test, `ports.ts`'s `listByTeam`, the fake, tasks.md checkboxes) |
| 4.6 runHackathonJob wiring | `npx vitest run test/domain/usecases/run-hackathon-job.test.ts` | 11/11 passed | N/A — pure Vitest with fakes | revert commit `6d5457c` (`src/domain/usecases/run-hackathon-job.ts`'s `if (job.threadId !== null)` branch, the added test case, tasks.md checkbox) |

Full-suite and typecheck evidence (after all 4 commits):
- `npx vitest run` → 51 files, **453/453 tests passed** (0 failed)
- `npm run typecheck` → clean, no errors

### Files Changed

| File | Action | What was done |
|------|--------|----------------|
| `src/domain/entities.ts` | Modified | Added `HackathonAnalysis.pinnedMessageId: number \| null` |
| `src/domain/ports.ts` | Modified | Added `HackathonAnalysisRepo.findByThreadId` and `.listByTeam` |
| `src/domain/usecases/analyze-hackathon.ts` | Modified | Persists `pinnedMessageId`, carried through on a same-URL refresh |
| `src/domain/usecases/show-analysis.ts` | Created | `showAnalysis` — any-member re-show by slug, `AnalysisNotFoundError` on a miss |
| `src/domain/usecases/link-analysis-to-topic.ts` | Created | `linkAnalysisToTopic` (admin-gated) + `postAnalysisAndLinkTopic` (permission-free core, reused by 4.6) |
| `src/domain/usecases/list-analyses.ts` | Created | `listAnalyses` — any-member listing via `formatHackathonsList` |
| `src/domain/usecases/run-hackathon-job.ts` | Modified | `runClaimedJob`'s fresh-completion path calls `postAnalysisAndLinkTopic` when `job.threadId !== null`, else the prior bare `post` |
| `test/domain/usecases/{show-analysis,link-analysis-to-topic,list-analyses}.test.ts` | Created | 13 tests across the named scenarios |
| `test/domain/usecases/run-hackathon-job.test.ts` | Modified | Added the 4.6 in-topic wiring test |
| `test/domain/usecases/analyze-hackathon.test.ts` | Modified | Updated 2 pre-existing `HackathonAnalysis` literals for the new field; added a `pinnedMessageId` carry-through assertion |
| `test/fakes/index.ts` | Modified | `fakeHackathonAnalysisRepo` gained `findByThreadId` and `listByTeam` |
| `openspec/changes/hackathon-analysis/tasks.md` | Modified | Phase 4 tasks 4.1-4.6 marked `[x]` |

### Deviations from Design

- **`HackathonAnalysisRepo` gained `findByThreadId` and `listByTeam`, and `HackathonAnalysis` gained `pinnedMessageId`.** design.md's "Interfaces / Contracts" section says `HackathonAnalysisRepo` is "unchanged," but Phase 5's own D1 test list (tasks.md 5.2) already names "unique `thread_id` (nullable), `moveLink`" — implying the repo's real shape was always going to grow for linking. Phase 4's use cases need a way to (a) find whichever analysis currently occupies a topic before moving the link, and (b) list every stored analysis; and the domain needs somewhere to persist the pinned message id so an old pin can be unpinned later (`ChatPublisher.unpin` takes a message id, which nothing before PR4 stored). Added the minimal port surface Phase 4 needs (`findByThreadId`, `listByTeam`, `save`-based mutation) rather than a combined atomic `moveLink` method — the atomicity Phase 5 will need for the D1 unique-`thread_id` constraint is a concrete-adapter concern; the domain port only needs to express the read/write shape, and `save` already exists. Phase 5 can add a dedicated atomic method to the D1 adapter (and to this port, if warranted) without changing Phase 4's use cases.
- **`postAnalysisAndLinkTopic` was extracted as a permission-free core in the same commit as `linkAnalysisToTopic` (4.3/4.4), one work unit before task 4.6 needed it.** This was called out at task 4.3/4.4 time (not deferred) because task 4.6's requirement — "wire `linkAnalysisToTopic` into `runHackathonJob`... design.md: a `/hackathon <url>` run inside a topic links and pins from the consumer" — cannot reuse the admin-gated `linkAnalysisToTopic` as-is: the queue consumer has no acting `MembershipId` to authorize (the producer already gated the fresh run on an admin in `requestHackathonAnalysis`, PR3). Extracting the core early avoided writing it twice.
- **The "reply states the link moved/was replaced" wording is plain English chosen by this batch, not a literal string from design.md or the spec.** Both spec scenarios only require that the reply "states" the outcome (spec: "the reply states the topic's previous link was replaced" / "the reply states the analysis moved from topic A to topic B"), without dictating exact phrasing. Chose `Replaced the topic's previous link (was <slug>).` and `Moved this analysis's link from another topic.` — topic identity is expressed by slug (a human-readable identifier already used everywhere else in replies) rather than by raw numeric thread ids, which would be meaningless to a reader.
- **`showAnalysis` and `listAnalyses` check that the actor is a registered member (via `MembershipRepo.get`), but do not check role.** This mirrors the existing `listRepoLinks` pattern exactly (`src/domain/usecases/list-repo-links.ts`: "Any registered member may list ... no admin check, unlike link/unlink") and the spec's own wording ("any registered member"/"any registered member run `/hackathon <slug>`").
- No other deviations. All three use cases and the 4.6 wiring match every named scenario in task 4.1-4.6 and design.md's "Pin Behavior" / "One Analysis Per Topic, Conflicts Move the Link" / "Pin Failure Falls Back to Unpinned Posting" sections.

### Issues Found

None.

### Remaining Tasks (not in this batch)

- [ ] Phase 5: Migration + D1 Repos (PR5)
- [ ] Phase 6: Static Fetcher (PR6)
- [ ] Phase 7: Rendered (Browser) Fetcher (PR7)
- [ ] Phase 8: Workers AI Extractor + GitHub Metadata (PR8)
- [ ] Phase 9: Queue Adapter, Consumer Wiring, Handler Tests (PR9)
- [ ] Phase 10: Publisher, Commands, Env, Wrangler (PR10)
- [ ] Phase 11: Operator Rollout (manual, not performed by apply)

### Workload / PR Boundary

- Mode: chained PR slice (stacked-to-main, per tasks.md's Chain strategy)
- Current work unit: PR4 (Phase 4 — Show, Link, List Use Cases + 4.6)
- Boundary: starts from `feat/hackathon-show-link-list`, branched off `main` right after PR3 (#22, including its correction and extra fix) merged; ends with all three use cases in place, `runHackathonJob` wired to link+pin fresh in-topic runs, Phase 4 tasks marked `[x]`, full suite and typecheck green.
- Estimated review budget impact: **exceeds the 400-line guard**, same as PR1-PR3. `git diff --shortstat main` reports src: 291 changed lines (7 files), test: 458 changed lines (6 files), openspec: 12 changed lines (1 file) = 761 changed lines total, above the forecast's ~300 estimate. Reported as-is per the instruction to flag but not self-split; the maintainer should decide whether to split this PR further or accept it with `size:exception`.

### Status

6/6 Phase 4 tasks complete (29/56 cumulative across Phases 1-4). Ready for `sdd-verify` on this slice, or for the next `sdd-apply` batch (Phase 5) once PR4 is reviewed/merged per the stacked-to-main chain strategy.

## PR4 correction (one transaction, reviewed at HEAD `fe129aa`)

Three corroborated findings fixed with Strict TDD (RED confirmed failing before each GREEN). READ-002/003/004 are deferred (out of scope for this correction).

### RELI-001 / RESI-002 — persisted redeliveries must link+pin, and linking must never throw

**Problem**: a job redelivered in `persisted` state with `job.threadId !== null` did a bare `chatPublisher.post`, silently dropping the topic link/pin that a fresh completion would have made. Separately, `postPersistedResult` had no `try/catch`, so a `chatPublisher.post`/link failure in that path escaped `runHackathonJob`'s "never throws" contract instead of routing through `classifyJobError`/`handleJobError` like `runClaimedJob` does.

Investigation also confirmed `postAnalysisAndLinkTopic`'s existing conflict checks (`displaced.id !== analysis.id`, `analysis.threadId !== threadId`) already made it idempotent for the same analysis re-linked to the same topic — no self-unpin/unlink/moved-note bug was found there; a regression test was added to lock that in rather than a production fix.

**RED** (`test/domain/usecases/run-hackathon-job.test.ts`):
```
npx vitest run test/domain/usecases/run-hackathon-job.test.ts
Tests  2 failed | 12 passed (14)
  persisted claim with a threadId: links and pins instead of a bare post (RELI-001/RESI-002)
    — expected [] to have a length of 1 but got +0 (chatPublisher.pinned)
  persisted claim: a transient post failure retries, then fails on the final attempt (RESI-001)
    — Error: Telegram unavailable (thrown out of runHackathonJob instead of returning `retry`)
```
Third new test (`persisted claim redelivered for an analysis already linked to that topic: does not unpin or unlink itself`) passed immediately, confirming the idempotency guard already existed.

**GREEN**: `postPersistedResult` now takes `attempt` and, when `job.threadId !== null`, calls `postAnalysisAndLinkTopic` (same completion path as `runClaimedJob`'s fresh path) instead of a bare post; its post/link step is wrapped in `try/catch` and any failure routes through `handleJobError(err, job, attempt, deps)` — same transient-retry/final-failure classification `runClaimedJob` uses. `runHackathonJob`'s `case "persisted"` now passes `attempt` through.
```
npx vitest run test/domain/usecases/run-hackathon-job.test.ts
Tests  14 passed (14)
```
Commit: `e4926a2 fix(hackathon-job): link+pin persisted redeliveries, never throw out (RELI-001/RESI-002/RESI-001)`

### READ-001 — truncate the analysis body, not the notes, past REPLY_MAX

**Problem**: `postAnalysisAndLinkTopic`'s reply concatenated `formatAnalysis(...)` (already truncated to 4096) with move/replace/pin-failure notes, so `text.length + "\n\n".length + notes.length` could exceed Telegram's 4096-char cap.

**RED** (`test/domain/usecases/link-analysis-to-topic.test.ts`) — a maximal-length analysis (6000-char name field, truncated by `formatAnalysis` to exactly `REPLY_MAX`) plus a "Replaced the topic's previous link" note:
```
npx vitest run test/domain/usecases/link-analysis-to-topic.test.ts
Tests  1 failed | 7 passed (8)
  truncates the analysis body, not the notes, to keep the reply within REPLY_MAX (READ-001)
    — expected 4145 to be less than or equal to 4096
```

**GREEN**: exported `REPLY_MAX` and the existing `truncate()` helper from `src/domain/hackathon/format.ts` (both were private before). Added `withNotes(text, notes)` in `link-analysis-to-topic.ts`: reserves room for `"\n\n" + notes.join("\n")` and truncates only the analysis body to fit, never the notes.
```
npx vitest run test/domain/usecases/link-analysis-to-topic.test.ts
Tests  8 passed (8)
```
Commit: `bb0dccb fix(hackathon-link): truncate the analysis body, not the notes, past REPLY_MAX (READ-001)`

### RELI-002 / RESI-003 — tracking only (docs)

Added `tasks.md` item 5.3a: the D1 adapter must make the topic move-link atomic (clear the displaced analysis's link and set the new one in a single `DB.batch`), via a new `HackathonAnalysisRepo.moveTopicLink(teamId, analysisId, threadId, pinnedMessageId)` port method replacing `postAnalysisAndLinkTopic`'s two separate `save` calls. No code change in this batch — this is a Phase 5 (D1 adapter) concern; the in-memory fake repo used by domain tests has no such atomicity boundary to violate.
Commit: `3b4908d docs(hackathon-analysis): track atomic D1 moveTopicLink (RELI-002/RESI-003)`

### Deferred (not in scope for this correction)

READ-002, READ-003, READ-004 — left untouched per instruction.

### Full-suite evidence (after all four commits)

```
npx vitest run
Test Files  51 passed (51)
     Tests  457 passed (457)

npm run typecheck
> tsc --noEmit
(no errors, exit 0)
```

### Diff vs `fe129aa`

```
git diff --stat fe129aa
 openspec/changes/hackathon-analysis/tasks.md       |   1 +
 src/domain/hackathon/format.ts                     |   5 +-
 src/domain/usecases/link-analysis-to-topic.ts      |  15 +-
 src/domain/usecases/run-hackathon-job.ts           |  34 ++++-
 test/domain/usecases/link-analysis-to-topic.test.ts |  26 ++++
 test/domain/usecases/run-hackathon-job.test.ts     | 167 +++++++++++++++++++
 6 files changed, 238 insertions(+), 10 deletions(-)
```
(this table excludes `apply-progress.md` itself, taken before this section was appended; the final commit below adds it.)

### Rollback boundary

- RELI-001/RESI-002/RESI-001: revert commit `e4926a2` (`src/domain/usecases/run-hackathon-job.ts`, its test).
- READ-001: revert commit `bb0dccb` (`src/domain/hackathon/format.ts`'s two new exports, `src/domain/usecases/link-analysis-to-topic.ts`'s `withNotes`, its test).
- RELI-002/RESI-003 tracking: revert commit `3b4908d` (`tasks.md` only, no code).

Each commit is independently revertible without touching the others.
