# Apply Progress: github-alerts

## PR1 — Domain Foundation (Phase 1)

**Mode**: Strict TDD (RED → GREEN, no REFACTOR step needed — first-pass implementations matched the fakes/patterns already in the codebase).

**Branch**: `feat/github-alerts-domain` (from `docs/github-alerts-planning`). No commit made — working tree only, per instruction.

### Completed Tasks

- [x] 1.1 RED: `github.ts` tests (`parseRepoFullName`, `formatGithubAlert` truncation)
- [x] 1.2 GREEN: `src/domain/github.ts`
- [x] 1.3 `RepoTopicLink` entity; `GithubOrgClaimRepo`, `RepoTopicLinkRepo`, `AlertSender` ports; `InvalidRepoError`, `OrgNotClaimedError`, `AlertSendFailedError`
- [x] 1.4 RED: `link-repo-to-topic` tests (claim gate, admin gate, move semantics — see Deviation note below)
- [x] 1.5 GREEN: `src/domain/usecases/link-repo-to-topic.ts`
- [x] 1.6 RED/GREEN: `unlink-repo.ts`, `list-repo-links.ts`
- [x] 1.7 RED: `route-github-event` tests (unclaimed-org ignored, unlinked-repo ignored, delivered, send-failed)
- [x] 1.8 GREEN: `src/domain/usecases/route-github-event.ts`
- [x] 1.9 `migrations/0002_github_alerts.sql`

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `migrations/0002_github_alerts.sql` | Created | `github_org_claims`, `repo_topic_links` tables per design.md SQL block, verbatim |
| `src/domain/github.ts` | Created | `RepoFullName` brand + `parseRepoFullName` (lowercases, validates `owner/repo` shape), `GithubEvent`/`GithubEventKind`/`GithubEventAction`, `formatGithubAlert` (allowlisted fields, 256-char title cap, 4096-char message cap) |
| `src/domain/entities.ts` | Modified | Added `RepoTopicLink` interface |
| `src/domain/ports.ts` | Modified | Added `GithubOrgClaimRepo`, `RepoTopicLinkRepo`, `AlertSender` interfaces |
| `src/domain/errors.ts` | Modified | Added `InvalidRepoError`, `OrgNotClaimedError`, `AlertSendFailedError` |
| `src/domain/usecases/link-repo-to-topic.ts` | Created | `linkRepoToTopic` — admin gate, claim gate (`OrgNotClaimedError`), upsert with `previousThreadId` in the result for move detection |
| `src/domain/usecases/unlink-repo.ts` | Created | `unlinkRepo` — admin gate, delegates removal, returns `boolean` (idempotent) |
| `src/domain/usecases/list-repo-links.ts` | Created | `listRepoLinks` — any registered member (no admin check), filters out links whose org claim no longer exists |
| `src/domain/usecases/route-github-event.ts` | Created | `routeGithubEvent` — org→team→link resolution, `ignored`/`delivered`/`send-failed` outcomes, catches `AlertSendFailedError` only (other errors propagate to become a 500 upstream) |
| `test/fakes/index.ts` | Modified | Added `fakeGithubOrgClaimRepo`, `fakeRepoTopicLinkRepo`, `fakeAlertSender` |
| `test/domain/github.test.ts` | Created | RED→GREEN for parsing and formatting/truncation |
| `test/domain/link-repo-to-topic.test.ts` | Created | RED→GREEN for `linkRepoToTopic` |
| `test/domain/unlink-repo.test.ts` | Created | RED→GREEN for `unlinkRepo` |
| `test/domain/list-repo-links.test.ts` | Created | RED→GREEN for `listRepoLinks` |
| `test/domain/route-github-event.test.ts` | Created | RED→GREEN for `routeGithubEvent` |
| `test/adapters/migrations.test.ts` | Modified | Added `github_org_claims`/`repo_topic_links` to the expected table list (this suite runs against the full `migrations/` directory via the shared test setup; adding 0002 without updating it would have broken an unrelated, pre-existing test) |

### TDD Cycle Evidence

| Task | RED (failing first, correct reason) | GREEN (implementation, passes) | REFACTOR |
|---|---|---|---|
| 1.1/1.2 `github.ts` | `test/domain/github.test.ts` — ran before `src/domain/github.ts` existed: `Cannot find module '../../src/domain/github'` | Created `github.ts`; `npx vitest run test/domain/github.test.ts` → 10/10 pass | None needed |
| 1.4/1.5 `link-repo-to-topic.ts` | `test/domain/link-repo-to-topic.test.ts` — ran before the module existed: `Cannot find module '.../usecases/link-repo-to-topic'` | Created `link-repo-to-topic.ts`; `npx vitest run test/domain/link-repo-to-topic.test.ts` → 4/4 pass | None needed |
| 1.6 `unlink-repo.ts` / `list-repo-links.ts` | Both test files ran before their modules existed: `Cannot find module` for each | Created both files; `npx vitest run test/domain/unlink-repo.test.ts test/domain/list-repo-links.test.ts` → 6/6 pass | None needed |
| 1.7/1.8 `route-github-event.ts` | `test/domain/route-github-event.test.ts` — ran before the module existed: `Cannot find module '.../usecases/route-github-event'` | Created `route-github-event.ts`; `npx vitest run test/domain/route-github-event.test.ts` → 4/4 pass | None needed |

Every RED run above failed with a module-resolution error (the right reason — the production file did not exist yet), never a passing or wrongly-failing assertion.

### Work Unit Evidence (PR1)

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run test/domain` → 24 new/changed domain tests pass (10 `github.test.ts` + 4 `link-repo-to-topic.test.ts` + 3 `unlink-repo.test.ts` + 3 `list-repo-links.test.ts` + 4 `route-github-event.test.ts`, plus pre-existing domain suites unaffected) |
| Runtime harness command/scenario and exact result | N/A — this unit is pure domain logic with in-memory fakes (`test/fakes`), no Workers/D1 runtime boundary. The migration SQL was still exercised through the real vitest-pool-workers D1 setup: `npx vitest run` (full suite, includes `test/adapters/migrations.test.ts` against the actual applied `0001_init.sql` + `0002_github_alerts.sql`) → 221/221 pass |
| Rollback boundary | Delete `src/domain/github.ts`, `src/domain/usecases/{link-repo-to-topic,unlink-repo,list-repo-links,route-github-event}.ts`, `migrations/0002_github_alerts.sql`, and the five new `test/domain/*.test.ts` files; revert the additive edits to `entities.ts`, `ports.ts`, `errors.ts`, `test/fakes/index.ts`, `test/adapters/migrations.test.ts`. No other file references these new symbols yet (confirmed: nothing outside the files above imports them) |

### Deviations from Design

- Task 1.4 lists "must be inside a topic" and "re-link reply names old/new topic" as scenarios for the `link-repo-to-topic` RED tests. Per design.md's own contract (`linkRepoToTopic({ teamId, actorMembershipId, repo, threadId }, deps)`) and the precedent in `bindDataChannel`/`/datachannel` (the null-thread refusal happens in `commands.ts`, not the use case), those two concerns are adapter/command-layer responsibilities that belong to Phase 5 (`/linkrepo`), not the domain use case. The domain test suite instead covers: claimed-org link succeeds, unclaimed-org link is rejected (`OrgNotClaimedError`) and stores no row, non-admin is refused, and re-linking moves the thread and reports `previousThreadId` (the data the Phase-5 command needs to build the "moved from topic A to topic B" reply). This matches the design's actual interface contract; nothing in the domain logic differs from design.md.
- No other deviations — `entities.ts`/`ports.ts`/`errors.ts`/`github.ts` additions and the migration SQL are verbatim to design.md's "File Changes", "Interfaces / Contracts", and SQL block.

### Issues Found / Risks

- **PR size budget overrun (flagged, not silently exceeded)**: measured via `git add -N` + `git diff --stat`, this PR1 slice is **871 authored lines added, 0 deleted, across 16 files** (update: after the review correction below, the same measurement shows **1121 lines added, 9 deleted, across 18 files** — the correction added required test coverage and a mechanical rename, which further increases the overrun; still no `size:exception` decision or split has been applied) — over the 400-line review budget and over the tasks.md estimate of ~350. Implementation-only code (migration + `entities`/`errors`/`ports` additions + `github.ts` + the 4 use cases + the one-line fix to the pre-existing `migrations.test.ts`) is ~356 lines, under budget on its own. The overrun is entirely the Strict-TDD test suite (5 new `test/domain/*.test.ts` files, 451 lines) plus the 3 new fakes in `test/fakes/index.ts` (64 lines) that Strict TDD requires before each implementation. No code was cut to force a fit, per the instruction to stop and report rather than exceed the budget silently. Recommend one of: (a) accept as `size:exception` given tests are the majority of the overrun and the change is otherwise self-contained and low-risk (pure domain, no I/O), or (b) split into two chained slices before commit — 1a: migration + entities/errors/ports + `github.ts` + `link-repo-to-topic`/`unlink-repo`/`list-repo-links` + tests + fakes (~650 lines, still over 400 but closer), 1b: `route-github-event.ts` + its test (~160 lines). Neither split cleanly fits 400 given the fakes are shared; a maintainer decision is needed before this becomes an actual PR.
- `test/adapters/migrations.test.ts` required a one-line-set edit (added two table names to an existing assertion) because it enumerates every table in the shared D1 test database, which now includes the new migration's tables. This is a pre-existing test, not new test debt, and was not in tasks.md — noted here for visibility.

## Correction — PR1 Review Ledger (frozen findings)

Applied on `feat/github-alerts-domain`, still no commit/push, `.codegraph/` untouched. Fixes the CRITICAL/other findings from the frozen PR1 review ledger.

### Findings Addressed

| Finding | Fix | New test result |
|---|---|---|
| RES-001 (CRITICAL) — "D1 is unavailable during routing" untested | Added `throws` option to `fakeGithubOrgClaimRepo`/`fakeRepoTopicLinkRepo` (`test/fakes/index.ts`), mirroring `fakeAlertSender`/`fakeChatAdminChecker`. Added two tests in `route-github-event.test.ts` asserting an unexpected error from `findTeamByOrg` and from the link `get` propagates (rejects), not an `ignored` outcome | **Passed immediately** — characterization test; `routeGithubEvent` already had no try/catch around those calls, so the error was already propagating correctly. No production code changed |
| REL-001 (CRITICAL) — `formatGithubAlert` reviewer line and `merged`/`review_requested` untested | Added exact-output tests in `test/domain/github.test.ts`: reviewer line present (`review_requested` + reviewer set), reviewer line omitted when unset, and an exact-output `merged` alert | **Passed immediately** — characterization tests; `formatGithubAlert`'s existing logic (conditional `Reviewer:` line, generic action interpolation) already produced the exact expected strings. No production code changed |
| REL-002/RES-002 — claim+link exist but team row missing (route-github-event.ts:45-50) untested | Added a test asserting `routeGithubEvent` rejects with `NotFoundError` when `teamRepo.get` returns null despite a matching claim and link | **Passed immediately** — characterization test; the `if (!team) throw new NotFoundError(...)` branch was already implemented exactly this way. No production code changed |
| READ-001 — file name must mirror the export | Renamed `src/domain/usecases/link-repo.ts` → `link-repo-to-topic.ts` and `test/domain/link-repo.test.ts` → `link-repo-to-topic.test.ts` (plain `mv`, files were untracked); updated the import in the renamed test file; updated all references in `tasks.md` and this file | N/A — mechanical rename, no behavior change; full suite reverified green after the rename |
| REL-003 — actor-membership-not-found untested for link/unlink | Added a `NotFoundError` test to `link-repo-to-topic.test.ts` and `unlink-repo.test.ts`, mirroring the existing non-member test in `list-repo-links.test.ts` | **Passed immediately** — characterization tests; both use cases already did `const actor = await deps.membershipRepo.get(...); if (!actor) throw new NotFoundError(...)` before any role check. No production code changed |

**No bugs were exposed.** Every new test in this correction passed on its first run — all five findings were untested gaps in coverage, not incorrect behavior. No production source file changed; only `test/fakes/index.ts` (added a `throws` option, same shape as existing fakes) and the five test files (new tests + one rename) changed, plus `tasks.md`/`apply-progress.md` reference updates.

### New Test Count

- Before this correction: 221 tests passing (initial PR1 apply)
- After the rename-only pass (before new tests): 221 passing, same count, different file name
- After all new tests: **229 tests passing** (+8: 1 in `link-repo-to-topic.test.ts`, 1 in `unlink-repo.test.ts`, 3 in `github.test.ts`, 3 in `route-github-event.test.ts`)
- `npx tsc --noEmit`: clean, no errors

### Files Changed (this correction)

| File | Action | What Was Done |
|------|--------|---------------|
| `test/fakes/index.ts` | Modified | Added `opts: { throws?: boolean }` to `fakeGithubOrgClaimRepo` and `fakeRepoTopicLinkRepo` |
| `src/domain/usecases/link-repo.ts` → `src/domain/usecases/link-repo-to-topic.ts` | Renamed | No content change beyond the rename |
| `test/domain/link-repo.test.ts` → `test/domain/link-repo-to-topic.test.ts` | Renamed + modified | Updated import path; added actor-not-found test |
| `test/domain/unlink-repo.test.ts` | Modified | Added actor-not-found test |
| `test/domain/github.test.ts` | Modified | Added reviewer-line and `merged` exact-output tests |
| `test/domain/route-github-event.test.ts` | Modified | Added two D1-unavailable propagation tests and one team-missing `NotFoundError` test |
| `openspec/changes/github-alerts/tasks.md` | Modified | Updated `link-repo.ts` references to `link-repo-to-topic.ts` |
| `openspec/changes/github-alerts/apply-progress.md` | Modified | This correction section; updated stale `link-repo.ts` references |

### Remaining Tasks

- [ ] Phase 2 (PR2): D1 adapters — `github-org-claim-repo.ts`, `repo-topic-link-repo.ts`, migration FK/UNIQUE/CHECK/isolation tests
- [ ] Phase 3 (PR3): `signature.ts`, route skeleton, env binding
- [ ] Phase 4 (PR4): mapper, alert sender, `buildGithubRouter`, e2e delivery tests
- [ ] Phase 5 (PR5): `/linkrepo`, `/unlinkrepo`, `/repos` commands
- [ ] Phase 6: operator rollout steps

### Workload / PR Boundary

- Mode: stacked-to-main, chained PR slice (PR1 of 5)
- Current work unit: Unit 1 — "Migration + domain (types, ports, errors, 4 use cases) with fakes"
- Boundary: starts from zero (first PR on `feat/github-alerts-domain`), ends at the four domain use cases + migration + fakes, all covered by passing tests
- Estimated review budget impact: **over budget** — see Issues Found above; needs an explicit `size:exception` or split decision before this is committed/pushed as an actual PR

### Status

9/9 Phase-1 tasks complete. The PR1 review correction above addresses all 5 frozen-ledger findings (RES-001, REL-001, REL-002/RES-002, READ-001, REL-003) — no bugs found, all new tests passed immediately, one mechanical rename applied. Full suite: `npx vitest run` → 229/229 pass. `npx tsc --noEmit` → clean, no errors. Ready for verify, with the PR-size risk called out above for the orchestrator/maintainer to resolve before commit.
