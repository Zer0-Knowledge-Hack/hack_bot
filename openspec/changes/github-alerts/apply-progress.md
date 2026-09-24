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

## PR2 — D1 Adapters (Phase 2)

**Mode**: Strict TDD, enforced incrementally — one behavior at a time (not the PR1 batch-RED pattern). For every new query/branch, a test was added and run *before* the code that satisfies it existed or before the code handled that branch, so each RED is either "module not found" (only ever the very first test in a file) or a genuine assertion failure against already-existing code (missing scoping, PK conflict, stale-row leakage). Still on `feat/github-alerts-d1` (from `main` at `cee64b9`, includes PR1). No commit made — working tree only, per instruction. `.codegraph/` untouched.

### Completed Tasks

- [x] 2.1 RED: migration test — table/FK/UNIQUE/CHECK enforcement, cross-team isolation on links
- [x] 2.2 GREEN: `src/adapters/d1/github-org-claim-repo.ts`, `repo-topic-link-repo.ts`

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `test/adapters/migrations.test.ts` | Modified | Added a `describe("migrations/0002_github_alerts.sql")` block: CHECK (org_login lowercase, repo_full_name lowercase), FK (claim→teams, link composite FK→claims), UNIQUE/PK (one org one team, one topic per repo per team), and a raw-SQL cross-team isolation check on `repo_topic_links` |
| `src/adapters/d1/github-org-claim-repo.ts` | Created | `createD1GithubOrgClaimRepo(db)` — `findTeamByOrg` (case-insensitive match against the lowercase-stored `org_login`), `isClaimedBy` (team-scoped exact match) |
| `test/adapters/d1/github-org-claim-repo.test.ts` | Created | 6 tests: not-found, found, case-insensitive lookup, claimed-true, tenant isolation (false for a non-claiming team), no-claim-at-all false |
| `src/adapters/d1/repo-topic-link-repo.ts` | Created | `createD1RepoTopicLinkRepo(db)` — `get`/`upsert` (`ON CONFLICT (team_id, repo_full_name) DO UPDATE SET thread_id, updated_at` — re-link moves it)/`remove` (`meta.changes === 1`)/`list`, all team-scoped |
| `test/adapters/d1/repo-topic-link-repo.test.ts` | Created | 10 tests: get not-found/found/tenant-isolated, upsert-insert/upsert-moves-existing, remove-found/remove-not-found, list-empty/list-all/list-tenant-isolated |

### TDD Cycle Evidence (one behavior at a time; each row is its own run)

| Behavior | RED (ran before the fix, failed for the stated reason) | GREEN (code added/changed, then passed) |
|---|---|---|
| `findTeamByOrg` not-found | Module missing: `Cannot find module '.../github-org-claim-repo'` | Created file, `findTeamByOrg` hardcoded to `null`, `isClaimedBy` throws `"not implemented"` → 1/1 pass |
| `findTeamByOrg` exact match | Assertion failure: `expected null to be 'team-org-1'` (hardcoded-null stub from the previous step) | Implemented real `SELECT team_id FROM github_org_claims WHERE org_login = ?` → 2/2 pass |
| `findTeamByOrg` case-insensitive | Assertion failure: `expected null to be 'team-org-2'` (exact-match query does not match `"Mixed-Org"` against stored `"mixed-org"`) | Added `.toLowerCase()` on the input → 3/3 pass |
| `isClaimedBy` claimed-true | Threw `Error: not implemented` (stub from step 1) | Implemented `SELECT 1 FROM github_org_claims WHERE org_login = ?` (deliberately not yet team-scoped) → 4/4 pass |
| `isClaimedBy` tenant isolation | Assertion failure: `expected true to be false` — the not-yet-team-scoped query from the previous step matched another team's claim on the same org | Added `AND team_id = ?` to the query → 6/6 pass (isolation + no-claim-at-all both green) |
| `get` not-found | Module missing: `Cannot find module '.../repo-topic-link-repo'` | Created file, `get` hardcoded to `null`, `upsert`/`remove`/`list` throw `"not implemented"` → 1/1 pass |
| `get` found | Assertion failure: `expected {...} to equal null` reversed — actually `expected null` vs the full row (hardcoded-null stub) | Implemented `SELECT * FROM repo_topic_links WHERE repo_full_name = ?` (deliberately not yet team-scoped) → 2/2 pass |
| `get` tenant isolation | Assertion failure: `expected {...} to be null` — the not-yet-team-scoped query returned the owning team's row for a different team's lookup | Added `AND team_id = ?` to the query → 3/3 pass |
| `upsert` insert | Threw `Error: not implemented` | Implemented a plain `INSERT` (no `ON CONFLICT` yet) → 4/4 pass |
| `upsert` move (re-link) | Threw `SQLITE_CONSTRAINT_PRIMARYKEY`: `UNIQUE constraint failed: repo_topic_links.team_id, repo_topic_links.repo_full_name` — the plain `INSERT` from the previous step cannot re-link | Added `ON CONFLICT (team_id, repo_full_name) DO UPDATE SET thread_id = excluded.thread_id, updated_at = excluded.updated_at` → 5/5 pass |
| `remove` found | Threw `Error: not implemented` | Implemented `DELETE ... WHERE team_id = ? AND repo_full_name = ?` returning `meta.changes === 1` → 6/6 pass |
| `remove` not-found (idempotent) | **Passed immediately** — characterization test; the `meta.changes === 1` check from the previous step already returns `false` when nothing matched. No production code changed | N/A |
| `list` empty | Threw `Error: not implemented` | Implemented `SELECT * FROM repo_topic_links` (deliberately no `WHERE` yet) → then failed again in the same run: `expected [] to equal [{...}]` — rows from earlier tests in the same D1-backed file leaked in, a genuine (if incidental) demonstration of the missing tenant scope. Added `WHERE team_id = ?` → 8/8 pass |
| `list` all-for-team, `list` tenant isolation | **Both passed immediately** — characterization tests; the `WHERE team_id = ?` fix from the previous step already covers them. No production code changed | N/A |
| Migration constraint tests (2.1, all 7) | **All passed immediately** — `migrations/0002_github_alerts.sql` was already shipped and applied in PR1 (task 1.9); these tests verify existing SQL against `env.DB` directly, not new production code in this PR. There is no RED→GREEN cycle for schema that already exists; this row is recorded for transparency rather than claimed as TDD-driven new code | N/A |

Every RED that involved a genuine behavior gap failed either on module resolution (only ever the first test in each file, never reused for a later behavior — per instruction, "a missing module is not an acceptable RED for behavior beyond the first test") or on a real assertion/constraint failure against code that already existed. The rows marked "passed immediately" are disclosed as characterization tests, not RED-driven, consistent with the same honest framing used in the PR1 review-correction section above.

### Work Unit Evidence (PR2)

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run test/adapters/d1` → 16/16 pass (6 `github-org-claim-repo.test.ts` + 10 `repo-topic-link-repo.test.ts`); `npx vitest run test/adapters/migrations.test.ts` → 15/15 pass (8 pre-existing + 7 new 0002 tests) |
| Runtime harness command/scenario and exact result | vitest-pool-workers D1 (`env.DB` from `cloudflare:test`), same harness as `test/adapters/d1/team-repo.test.ts`. Full suite: `npx vitest run` → 252/252 pass (32 files, up from 229/30 before this PR) |
| Rollback boundary | Delete `src/adapters/d1/{github-org-claim-repo,repo-topic-link-repo}.ts` and `test/adapters/d1/{github-org-claim-repo,repo-topic-link-repo}.test.ts`; revert the additive `describe` block appended to `test/adapters/migrations.test.ts`. Nothing outside these files imports the two new adapters yet — composition wiring is explicitly out of scope for PR2 per tasks.md Phase 2 |

### Deviations from Design

- None. `github-org-claim-repo.ts`/`repo-topic-link-repo.ts` match design.md's "Interfaces / Contracts" signatures verbatim; `upsert` uses the exact `ON CONFLICT (team_id, repo_full_name) DO UPDATE SET thread_id = excluded.thread_id, updated_at = excluded.updated_at` clause called for in design.md ("ON CONFLICT DO UPDATE thread_id") and ports.ts. One addition beyond the literal port signature, not a deviation from it: `findTeamByOrg` lowercases its input before querying, since `GithubOrgClaimRepo` is documented as the sole cross-team lookup that receives an org login before any case normalization can have happened upstream (the Phase-4 mapper, which normalizes `GithubEvent.org`, does not exist yet), while claims are stored lowercase by the migration's CHECK constraint. `isClaimedBy` receives its `orgLogin` argument already lowercase from `link-repo-to-topic.ts`'s `orgLoginFromRepo` (derived from the branded, already-lowercase `RepoFullName`), so the same `.toLowerCase()` there is a no-op safety net, not a behavior change.

### Issues Found / Risks

- None. Production code is small (112 lines total across both adapters), no D1 error-translation was needed beyond the existing constraint set (the composite FK on `repo_topic_links` is enforced by the migration itself; nothing in this PR's use-case-facing methods needs to catch and re-translate a constraint violation, since `link-repo-to-topic.ts` already checks `isClaimedBy` before calling `upsert`).

### New Test Count

- Before this PR: 229 tests passing (30 files)
- After this PR: **252 tests passing** (32 files) — +23 (7 migration constraint tests + 6 `github-org-claim-repo.test.ts` + 10 `repo-topic-link-repo.test.ts`)
- `npx tsc --noEmit`: clean, no errors

### Line Counts

| Category | Files | Lines |
|---|---|---|
| Production | `src/adapters/d1/github-org-claim-repo.ts` (32) + `repo-topic-link-repo.ts` (80) | **112** |
| Tests | `test/adapters/d1/github-org-claim-repo.test.ts` (89) + `repo-topic-link-repo.test.ts` (232) + `migrations.test.ts` additions (145, per `git diff --stat`) | **466** |

Production code is well under the 400-line budget on its own (112 lines vs. the ~250 estimate in tasks.md). The test-heavy total (466 lines) is the `size:exception` the user pre-accepted for test overrun; no code was cut and no split was needed.

### Workload / PR Boundary

- Mode: stacked-to-main, chained PR slice (PR2 of 5), stacked on `feat/github-alerts-d1` (from `main` at `cee64b9`, includes PR1)
- Current work unit: Unit 2 — "D1 repos: claims, links, FK/isolation tests"
- Boundary: starts from PR1 (domain layer + migration, unchanged in this PR), ends at the two D1 adapters implementing `GithubOrgClaimRepo`/`RepoTopicLinkRepo`, all covered by passing tests. Not wired into `composition.ts` — that is explicitly Phase 4 (task 4.5)
- Estimated review budget impact: production code is comfortably within budget; test overrun is pre-accepted per instruction

### Status

2/2 Phase-2 tasks complete. Full suite: `npx vitest run` → 252/252 pass. `npx tsc --noEmit` → clean, no errors. No composition wiring performed (out of scope). Ready for verify / review. Remaining: Phase 3 (`signature.ts`, route skeleton, env binding), Phase 4 (mapper, alert sender, `buildGithubRouter`, e2e delivery), Phase 5 (`/linkrepo`, `/unlinkrepo`, `/repos` commands), Phase 6 (operator rollout).

## Correction — PR2 Review Ledger (frozen findings)

Applied on `feat/github-alerts-d1`, still no commit/push, `.codegraph/` untouched. Fixes the confirmed findings from the frozen PR2 review ledger. Task 6.3 in tasks.md was already checked (operator claimed the org in production) and left unchanged.

### Findings Addressed

| Finding | Fix | RED evidence | New test result |
|---|---|---|---|
| RISK-001 (CRITICAL) / REL-002 / READ-001 — `upsert(teamId, link)` ignored the `teamId` argument and wrote under `link.teamId`, a silent cross-tenant write if a caller ever passed mismatched values | `src/adapters/d1/repo-topic-link-repo.ts`: `teamId` argument is now authoritative — bound directly into the SQL instead of `link.teamId`, and a mismatch throws a new `TenantMismatchError` (added to `src/domain/errors.ts`) before touching the database. `test/fakes/index.ts`'s `fakeRepoTopicLinkRepo.upsert` aligned to the identical check | D1 test (`test/adapters/d1/repo-topic-link-repo.test.ts`): ran against the pre-fix code — `promise resolved "undefined" instead of rejecting` (it silently wrote under `link.teamId` instead of rejecting). Fake test (`test/domain/link-repo-to-topic.test.ts`): same failure mode against the pre-fix fake | **Real bug found and fixed.** Both tests failed for the right reason before the fix, passed after. `npx vitest run test/adapters/d1/repo-topic-link-repo.test.ts` → 13/13; `npx vitest run test/domain/link-repo-to-topic.test.ts` → 6/6 |
| REL-003 — no test proved `remove` was tenant-scoped | Added `remove is tenant-scoped: remove(teamB, repo) does not delete teamA's link for the same repo path` to `repo-topic-link-repo.test.ts` | **Passed immediately** — characterization test; `remove`'s existing `WHERE team_id = ? AND repo_full_name = ?` (written in the original PR2 apply, before this correction) already scoped correctly. No production code changed |
| REL-001 — `fakeGithubOrgClaimRepo.isClaimedBy`/`findTeamByOrg` did exact-string org matching, while the real D1 adapter lowercases both lookups; a domain test could pass against the fake on a case assumption the real adapter would reject | `test/fakes/index.ts`: both fake methods now call `orgLogin.toLowerCase()` before matching, mirroring `createD1GithubOrgClaimRepo`. Added a D1 test (`isClaimedBy matches regardless of the input's case, exactly like findTeamByOrg`) to `github-org-claim-repo.test.ts`, and a new `describe("fakeGithubOrgClaimRepo (contract parity with the D1 adapter)")` block to `route-github-event.test.ts` for the fake | D1 test: **passed immediately** — the adapter already lowercased (written in the original PR2 apply). Fake tests: ran against the pre-fix fake — `expected true to be false` / `expected null to be 'team-1'` (exact-match fake rejected the differently-cased input) | D1: no change needed, already correct. **Fake bug found and fixed** — the two new fake-parity tests failed for the right reason before the fix, passed after. `npx vitest run test/adapters/d1/github-org-claim-repo.test.ts` → 8/8; `npx vitest run test/domain/route-github-event.test.ts` → 9/9 |
| RES-001 — no test proved a raw D1 failure (not a domain-level "not found") propagates rather than being swallowed | Added a `failingDb()` stub (implements only `D1Database.prepare()`, returning a statement whose `bind/first/run/all` all reject) to both `test/adapters/d1/github-org-claim-repo.test.ts` and `repo-topic-link-repo.test.ts`, and one test per adapter (`findTeamByOrg` / `get`) asserting the rejection propagates | N/A — see below | **Passed immediately** — characterization tests; neither adapter has a try/catch around its D1 calls, so an `await` on a rejecting D1 call already rejects the caller. No production code changed. This is the cleanest available way to inject a D1-level failure into these adapters without touching the shared `env.DB` used by every other test in the same file — a real `env.DB` failure (e.g. a closed connection) is not something the Workers `cloudflare:test` binding exposes for deliberate breakage, so a structural stub at the `D1Database` interface boundary (only `prepare()` is called by these methods) was used instead of forcing an artificial constraint violation that would conflate "D1 unavailable" with "expected schema rejection" |

**One real bug found**: RISK-001/REL-002/READ-001 — `upsert` silently wrote a link under `link.teamId` instead of the tenant-scoped `teamId` argument, which a caller bug could have used to write into another team's tenant. Fixed with an explicit rejection (`TenantMismatchError`) rather than a silent correction, so a caller passing mismatched values learns about its bug instead of the write being quietly redirected. One fake bug found (REL-001): the in-memory fakes did exact-case org matching, diverging from the real adapter's lowercase normalization — fixed to match. All other findings were confirmed-correct-but-untested behavior; the new tests pin that down without any production code change.

### New Test Count

- Before this correction: 252 tests passing (32 files)
- After this correction: **260 tests passing** (32 files, same file count — no new test files, only additions to existing ones) — +8 (1 D1 mismatch-rejection test + 1 fake mismatch-rejection test + 1 D1 tenant-isolation-for-remove test + 1 D1 case-insensitive-isClaimedBy test + 2 fake case-parity tests + 2 D1-failure-propagation tests)
- `npx tsc --noEmit`: clean, no errors

### Files Changed (this correction)

| File | Action | What Was Done |
|------|--------|---------------|
| `src/domain/errors.ts` | Modified | Added `TenantMismatchError` |
| `src/adapters/d1/repo-topic-link-repo.ts` | Modified | `upsert` now binds `teamId` (the argument) instead of `link.teamId`, and rejects with `TenantMismatchError` on a mismatch before any database write |
| `test/fakes/index.ts` | Modified | `fakeRepoTopicLinkRepo.upsert` rejects on the same `teamId`/`link.teamId` mismatch; `fakeGithubOrgClaimRepo.findTeamByOrg`/`isClaimedBy` lowercase their `orgLogin` input |
| `test/adapters/d1/repo-topic-link-repo.test.ts` | Modified | Added the mismatch-rejection test, the `remove` tenant-isolation test, the `failingDb()` stub, and the `get`-propagates-D1-failure test |
| `test/adapters/d1/github-org-claim-repo.test.ts` | Modified | Added the `isClaimedBy` case-insensitivity test, the `failingDb()` stub, and the `findTeamByOrg`-propagates-D1-failure test |
| `test/domain/link-repo-to-topic.test.ts` | Modified | Added the `fakeRepoTopicLinkRepo` mismatch-rejection parity test |
| `test/domain/route-github-event.test.ts` | Modified | Added the `fakeGithubOrgClaimRepo` case-insensitivity parity tests |
| `openspec/changes/github-alerts/apply-progress.md` | Modified | This correction section |

### Status (after correction)

All 4 confirmed PR2 review findings addressed. Full suite: `npx vitest run` → 260/260 pass. `npx tsc --noEmit` → clean, no errors. Two genuine bugs found and fixed (the `upsert` tenant-scoping bug in production code, and the case-matching divergence in the fake); the remaining findings were untested-but-correct behavior, now pinned down by tests. No commit/push made; `.codegraph/` untouched; task 6.3 left checked as instructed.

## PR3 — Signature and Route Skeleton (Phase 3)

**Mode**: Strict TDD, RED → GREEN per module (signature.ts first, then the route). Scope explicitly limited to `signature.ts` + the `POST /github/webhook` route skeleton (401/500/ping/malformed-JSON) + the `GITHUB_WEBHOOK_SECRET` binding — no event mapping, org/repo routing, or Telegram delivery (Phase 4). Still on `feat/github-alerts-route` (from `main` at `5b6d4f4`, includes PR1 + PR2). No commit made — working tree only, per instruction. `.codegraph/` untouched.

### Completed Tasks

- [x] 3.1 RED: `test/adapters/github/signature.test.ts` — missing header, wrong secret, right-length-wrong-content (constant-time path), malformed header shape, valid signature, empty secret, undefined secret.
- [x] 3.2 GREEN: `src/adapters/github/signature.ts` — `verifyGithubSignature(rawBody, signatureHeader, secret)`. Secret emptiness checked first (throws `ConfigError`, never verifies against an empty key); header validated against `^sha256=[0-9a-f]{64}$`; HMAC-SHA256 via `crypto.subtle.importKey`/`sign` over the raw `ArrayBuffer`; length-checked, then `crypto.subtle.timingSafeEqual` (same WebCrypto primitive already proven available by `test/runtime-assumptions/timing-safe-equal.test.ts`, same length-check-then-compare pattern as `src/index.ts`'s `isValidSecret`).
- [x] 3.3 RED: `test/http/github-webhook.test.ts` — signature gate (missing/wrong/same-length-wrong → 401), status policy (ping → 200, malformed JSON → 200, non-object JSON → 200, unsupported/not-yet-wired event → 200), production-safety fail-closed suite (empty secret → 500 for unsigned, well-formed-signed, and header-less requests; never crashes; Telegram route and `/health` unaffected), and a no-leak suite (payload/signature/secret never appear in `console.log` output). D1-failure-500 scenario from the tasks.md task-3.3 wording is deferred — see Deviations below.
- [x] 3.4 GREEN: `src/index.ts` — `app.post("/github/webhook", ...)`; `src/env.ts` — `GITHUB_WEBHOOK_SECRET: string`; `.dev.vars.example` — documented placeholder; `vitest.config.ts` — `GITHUB_WEBHOOK_SECRET: "test-github-webhook-secret-value"` miniflare binding.

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `src/adapters/github/signature.ts` | Created | `verifyGithubSignature` — HMAC-SHA256 over raw bytes, constant-time compare, `ConfigError` on empty/missing secret |
| `test/adapters/github/signature.test.ts` | Created | 7 tests covering every HMAC Signature Verification scenario in `specs/github-webhook/spec.md` plus the two secret-misconfiguration cases |
| `src/index.ts` | Modified | Added `POST /github/webhook`: reads raw `arrayBuffer()`, verifies signature before any `JSON.parse`, 401 on failed verification, 500 + `ConfigError`-reason log on unset/empty secret, 200 for `ping`/malformed JSON/non-object payload/any other event (placeholder pending Phase 4) |
| `src/env.ts` | Modified | Added `GITHUB_WEBHOOK_SECRET: string` to `Env` |
| `.dev.vars.example` | Modified | Added `GITHUB_WEBHOOK_SECRET` placeholder with a one-line rollout note |
| `vitest.config.ts` | Modified | Added `GITHUB_WEBHOOK_SECRET` miniflare test binding, mirroring `WEBHOOK_SECRET`'s existing test-only-value pattern |
| `test/http/github-webhook.test.ts` | Created | 13 tests: signature gate, status policy, fail-closed-on-unset-secret (including cross-checks that `/telegram/webhook` and `/health` stay unaffected), and no-payload/signature/secret-in-logs |

### TDD Cycle Evidence

| Task | RED (failing first, correct reason) | GREEN (implementation, passes) | REFACTOR |
|---|---|---|---|
| 3.1/3.2 `signature.ts` | `npx vitest run test/adapters/github/signature.test.ts` before the module existed: `Cannot find module '../../../src/adapters/github/signature'` (0 tests ran, failed suite) | Created `signature.ts`; `npx vitest run test/adapters/github/signature.test.ts` → 7/7 pass | None needed — implementation is a single small pure-ish async function, already minimal |
| 3.3/3.4 route skeleton | `npx vitest run test/http/github-webhook.test.ts` before the route existed: 10/13 failed with `404` (route not registered) or, for one test, a `DataError` from trying to HMAC-sign with an empty key in the test helper itself (fixed by rewriting that one test to send a well-formed signature against the *request's* empty-secret env, rather than trying to sign with an empty key) | Added the route to `src/index.ts` + `env.ts`/`vitest.config.ts`/`.dev.vars.example` bindings; `npx vitest run test/http/github-webhook.test.ts` → 13/13 pass | None needed — route mirrors the existing `/telegram/webhook` error-boundary shape (try/catch around composition-equivalent step, malformed-body 200, safe logging) |

Every RED run above failed for the right reason (module resolution or route-not-registered 404), never a passing or wrongly-failing assertion. The one non-production-related RED (`DataError` from a broken test helper) was a test-authoring mistake caught during RED, not a production bug — fixed by correcting the test before writing any production code for that branch.

### Work Unit Evidence (PR3 / Unit 3)

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run test/adapters/github/signature.test.ts test/http/github-webhook.test.ts` → 20/20 pass (7 + 13) |
| Runtime harness command/scenario and exact result | `SELF`/`app.request` through the real Hono app in the Workers runtime (`@cloudflare/vitest-pool-workers`), same harness family as `test/http/webhook-e2e.test.ts` — exercises the actual route registration, `c.env` binding resolution, and `crypto.subtle` in the Workers isolate, not a Node polyfill. Full suite: `npx vitest run` → 280/280 pass (34 files, up from 260/32 before this PR) |
| Rollback boundary | Delete `src/adapters/github/signature.ts`, `test/adapters/github/signature.test.ts`, `test/http/github-webhook.test.ts`; remove the `app.post("/github/webhook", ...)` block from `src/index.ts`; remove `GITHUB_WEBHOOK_SECRET` from `src/env.ts`, `vitest.config.ts`, and `.dev.vars.example`. Nothing outside these files references the new route or `verifyGithubSignature` yet — the Telegram route and `/health` are untouched aside from the shared `Env` type gaining one more required field (verified unaffected by two dedicated tests) |

### Deviations from Design

- **tasks.md task 3.3's "D1 failure 500" scenario is deferred to PR4, not implemented here.** This PR has no D1/routing wiring at all (no mapper, no `routeGithubEvent` call, no `buildGithubRouter`) — that lands in Phase 4 per design.md's PR slicing (#4: "the mapper, alert sender, `buildGithubRouter` wiring and the end-to-end delivery tests"). There is no code path in this PR that could reach D1, so a "D1 failure → 500" test would have nothing to exercise except a `throw` inserted purely for the test's sake, which would misrepresent Phase-4 behavior instead of testing it. This was an explicit scope instruction for this batch (only `signature.ts` + the 401/500-on-config/ping/malformed-JSON route skeleton + the env binding — no event mapping, routing, or Telegram delivery). The design.md "GitHub route status policy" table's Infrastructure-Failures row and its spec scenario remain correctly the responsibility of PR4, where the D1 call actually exists.
- **Non-ping events currently return 200 unconditionally (no mapper yet), not spec-driven "unsupported" filtering.** Per design.md's own PR slicing, the mapper (`event-mapper.ts`) that determines "supported vs. unsupported event/action" is Phase 4 work. Until it exists, every non-ping event is a de facto unsupported event under this skeleton, and the design.md status table already assigns unsupported events the same 200 — so this is a temporary but spec-consistent placeholder, not a violation of the "Unsupported Event or Action Ignored" requirement. It will be replaced with dispatch to `mapGithubEvent`/`routeGithubEvent` in PR4, at which point the currently-blanket 200 branch narrows to only truly-unsupported combinations.
- No other deviations. `signature.ts` matches design.md's "Signature check" row verbatim (regex → HMAC over raw bytes → constant-time compare → length-check-before-compare, all before `JSON.parse`; empty/missing secret is a `ConfigError`, never a verify-against-empty-key). The route's 401/500/200 mapping matches the "GitHub route status policy" table's rows that apply to this PR's scope exactly.

### Issues Found / Risks

- None. Production code is small (`signature.ts` 47 lines + the route addition to `src/index.ts` ~52 lines + 4 lines each in `env.ts`/`.dev.vars.example` + 1 line in `vitest.config.ts` ≈ 108 lines total), comfortably under the 400-line budget and the ~250-line tasks.md estimate — no `size:exception` needed for this PR, unlike PR1/PR2's test-driven overruns.
- One test-authoring bug was caught and fixed during RED (see TDD Cycle Evidence above): the original "signed against the empty secret itself" test tried to HMAC-sign with a zero-length key, which WebCrypto rejects with a `DataError` unrelated to the production code under test. Rewritten to send a well-formed signature (signed under the real test secret) against a request whose *environment* has an empty `GITHUB_WEBHOOK_SECRET` — the actually-intended scenario (secret unset in the deployed env, regardless of what an attacker sends).

### New Test Count

- Before this PR: 260 tests passing (32 files)
- After this PR: **280 tests passing** (34 files) — +20 (7 `signature.test.ts` + 13 `github-webhook.test.ts`)
- `npx tsc --noEmit`: clean, no errors (one pre-fix error surfaced and was corrected: a test helper's `ArrayBufferLike`-typed `.buffer` needed an explicit `as ArrayBuffer` cast to satisfy `verifyGithubSignature`'s `ArrayBuffer` parameter — a test-file-only fix, no production signature changed)

### Line Counts

| Category | Files | Lines |
|---|---|---|
| Production | `src/adapters/github/signature.ts` (47) + `src/index.ts` route addition (52) + `src/env.ts` addition (4) | **103** |
| Tests | `test/adapters/github/signature.test.ts` (77) + `test/http/github-webhook.test.ts` (195) | **272** |
| Config/docs (not counted as code) | `.dev.vars.example` (+4), `vitest.config.ts` (+1) | 5 |

Production code (103 lines) is well under the 400-line budget and under the ~250-line tasks.md estimate. No `size:exception` is needed for PR3 — this is the first PR in the chain where both production and test totals individually and combined stay under budget.

### Workload / PR Boundary

- Mode: stacked-to-main, chained PR slice (PR3 of 5), stacked on `feat/github-alerts-route` (from `main` at `5b6d4f4`, includes PR1 + PR2)
- Current work unit: Unit 3 — "`signature.ts` + route skeleton (401/500/ping/malformed JSON) + env binding"
- Boundary: starts from PR1+PR2 (domain + D1 adapters, unchanged in this PR), ends at the signature verifier and the route skeleton returning the correct status for every case in scope (401 unauthorized, 500 config-error/fail-closed, 200 ping/malformed/non-object/not-yet-supported). Explicitly does not wire the mapper, `routeGithubEvent`, `buildGithubRouter`, or any Telegram delivery — that is Phase 4 (task 4.5 wires this route's placeholder branch to real routing)
- Estimated review budget impact: comfortably within budget on both production and test code; no exception needed

### Remaining Tasks

- [ ] Phase 4 (PR4): mapper, alert sender, `buildGithubRouter`, e2e delivery tests (including the D1-failure-500 scenario deferred from this PR)
- [ ] Phase 5 (PR5): `/linkrepo`, `/unlinkrepo`, `/repos` commands
- [ ] Phase 6.1/6.2: operator rollout steps (secret provisioning after this PR merges, org webhook config after PR4 merges)

### Status

4/4 Phase-3 tasks complete. Full suite: `npx vitest run` → 280/280 pass. `npx tsc --noEmit` → clean, no errors. Telegram webhook and `/health` verified unaffected by dedicated tests in this PR. Production code (103 lines) is well within the 400-line budget — no exception needed. Ready for verify.

## Correction — PR3 Review Ledger (warnings, no blocker/critical)

Applied on `feat/github-alerts-route`, still no commit/push, `.codegraph/` untouched. Fixes the 4 warning-level findings from the frozen PR3 review ledger (no blocker/critical findings existed). Strict TDD: a failing test was written first for both behavior changes (RES-002, RES-001); the two readability findings (READ-001, READ-002) are pure extractions with no behavior change, verified against the existing suite as an approval-test safety net throughout.

### Findings Addressed

| Finding | Fix | RED evidence | New test result |
|---|---|---|---|
| RES-002 — catch-all branch for signature-verified, non-ping events returned 200 without logging, contradicting design.md:27 ("unsupported event or action: 200, logged") | `src/index.ts`: added `logger.log({ event: "github-webhook", outcome: "ok", reason: "ignored:not-yet-routed" })` before the final `return c.text("ok", 200)`, using only allowlisted `LogEvent` fields (no payload, no event type/action) | `test/http/github-webhook.test.ts` new test ran before the fix: `expected undefined to deeply equal {...}` — no `github-webhook` log entry existed at all | **New behavior added, test passed after the fix.** `npx vitest run test/http/github-webhook.test.ts` → 14/14 (was 13/13) |
| RES-001 — `await c.req.arrayBuffer()` was unguarded, unlike the Telegram route's guarded `c.req.json()` | `src/index.ts`: wrapped the raw-body read in try/catch; on failure, logs `errorCode` only (no payload/secret) and returns `c.text("ok", 200)` — the same status the Telegram route uses for an unparseable body | Added a test with a `ReadableStream` body that calls `controller.error(...)` before any data — this **is** cleanly injectable in the Workers test runtime via `app.request(new Request(..., { body: brokenStream, duplex: "half" }))`. Ran before the fix: `expected 200 to be 500` — the unguarded `await` let the rejection escape the handler, and Hono's default error boundary answered a plain uncontrolled 500 instead of the documented 200 policy (and without the safe logger) | **Real gap found and fixed** (the route was one dropped-connection away from an unlogged, non-policy-compliant 500). `npx vitest run test/http/github-webhook.test.ts` → 15/15 (was 14/14) |
| READ-001 — the constant-time comparison (length check, then `crypto.subtle.timingSafeEqual`) was duplicated in `src/index.ts`'s `isValidSecret` and `src/adapters/github/signature.ts` | Extracted `timingSafeCompare(provided, expected)` to `src/adapters/crypto/timing-safe-compare.ts`; `isValidSecret` was removed and both `/telegram/webhook` and `verifyGithubSignature` now call the shared helper. No behavior change: same `!provided` short-circuit, same length-check-before-compare order | New module written before existing code depended on it (TDD-for-new-code: `Cannot find module '.../timing-safe-compare'`), then implemented | GREEN: `npx vitest run test/adapters/crypto/timing-safe-compare.test.ts` → 5/5 (new). Safety net (no regressions): `npx vitest run test/http/webhook-secret.test.ts test/http/webhook-e2e.test.ts test/adapters/github/signature.test.ts test/http/github-webhook.test.ts test/runtime-assumptions/timing-safe-equal.test.ts` → all green before and after wiring the callers |
| READ-002 — the `signHex` test helper was copy-pasted in `test/adapters/github/signature.test.ts` and `test/http/github-webhook.test.ts` | Extracted to `test/support/github-hmac.ts`; both test files now import it | N/A — test-only refactor, no production behavior. Both files' existing tests are the approval-test safety net | Ran both files immediately after the extraction, before any other change: `npx vitest run test/adapters/github/signature.test.ts test/http/github-webhook.test.ts` → 20/20, unchanged from before the extraction |

**Two real gaps found (RES-001, RES-002), both fixed with new logging/guarding, not by weakening any test.** READ-001/READ-002 were pure duplication removals with zero behavior change, confirmed by the pre-existing suites staying green throughout.

### Files Changed (this correction)

| File | Action | What Was Done |
|------|--------|---------------|
| `src/adapters/crypto/timing-safe-compare.ts` | Created | `timingSafeCompare(provided, expected)` — the shared constant-time string compare |
| `test/adapters/crypto/timing-safe-compare.test.ts` | Created | 5 tests: identical, same-length-different, shorter, longer, empty-vs-non-empty |
| `src/index.ts` | Modified | Removed local `isValidSecret`; Telegram route now calls `timingSafeCompare`. GitHub route: guarded `c.req.arrayBuffer()` (RES-001), added the not-yet-routed log line (RES-002) |
| `src/adapters/github/signature.ts` | Modified | Replaced the inline length-check + `timingSafeEqual` with a call to the shared `timingSafeCompare` |
| `test/support/github-hmac.ts` | Created | Shared `signHex` helper (READ-002) |
| `test/adapters/github/signature.test.ts` | Modified | Imports `signHex` from `test/support/github-hmac` instead of a local copy |
| `test/http/github-webhook.test.ts` | Modified | Imports `signHex` from `test/support/github-hmac`; added the RES-002 logging test and the RES-001 unreadable-body test |
| `openspec/changes/github-alerts/apply-progress.md` | Modified | This correction section |

### New Test Count

- Before this correction: 280 tests passing (34 files)
- After this correction: **287 tests passing** (35 files) — +7 (5 `timing-safe-compare.test.ts` + 1 RES-002 log test + 1 RES-001 unreadable-body test)
- `npx tsc --noEmit`: clean, no errors

### Which Tests Failed First vs. Passed Immediately

- **Failed first (RED, for the right reason), then passed after the fix**: RES-002's log-assertion test (`expected undefined`, no log entry existed) and RES-001's unreadable-body test (`expected 200 to be 500` — the route was actually returning an uncontrolled 500 via Hono's default error boundary before the fix).
- **New module, no prior code to fail against**: `timing-safe-compare.test.ts` failed on module resolution (`Cannot find module`) before the helper existed — the standard "RED via missing production code" pattern for brand-new pure logic, not a behavior regression.
- **Passed immediately (approval tests, no RED expected)**: every pre-existing test in `webhook-secret.test.ts`, `webhook-e2e.test.ts`, `signature.test.ts`, `github-webhook.test.ts` (13 pre-existing ones), and `timing-safe-equal.test.ts` — these are the READ-001/READ-002 refactor's safety net and were never expected to fail, since no behavior changed for them.

### Status (after correction)

All 4 PR3 review warnings addressed. Full suite: `npx vitest run` → 287/287 pass. `npx tsc --noEmit` → clean, no errors. Two real gaps found and fixed (RES-001's unguarded body read escaping to an uncontrolled 500; RES-002's missing log line for the design-mandated "unsupported event: 200, logged" policy); two pure duplication removals (READ-001, READ-002) verified behavior-neutral by the existing suite staying green throughout. No commit/push made; `.codegraph/` untouched.

## Correction 2 (maintainer-authorized) — Scoped-Validator Escalation on Correction 1's RES-001 Fix

Applied on `feat/github-alerts-route`, still no commit/push, `.codegraph/` untouched. Scope: only `test/http/github-webhook.test.ts` (~124-140) and `src/index.ts` (~99-109), per the maintainer's explicit "touch nothing else" instruction.

### Finding

The scoped fix-delta validator escalated one fix-caused defect in correction 1's RES-001 fix: when `c.req.arrayBuffer()` throws, the route returned 200 before signature verification. That is wrong on two counts — the failure is a **transient, transport-level** read failure (not malformed content that was successfully read), and the request was **never authenticated** at that point. design.md's status policy assigns 500 to transient/unexpected failures precisely so the delivery is marked failed in GitHub and can be redelivered; a body-read failure is exactly that case, not the "redelivering the same bytes can never succeed" case that correctly applies to the JSON.parse/non-object branches later in the same handler (those DID fully read the bytes; malformed content redelivered unchanged will fail identically forever).

### Fix (test-first)

1. **RED**: Changed the existing correction-1 test (`test/http/github-webhook.test.ts`, "unreadable raw body" describe block) to assert `res.status` is `500` instead of `200`, and added an exact-match assertion on the logged entry (`{ event: "github-webhook", outcome: "error", errorCode: "Error" }`, plus a check that the raw error message never appears in any log line). Ran against the unmodified correction-1 code: `expected 200 to be 500` — confirmed RED for the exact reason the finding describes (the route was still returning 200 on this path).
2. **GREEN**: Changed `src/index.ts`'s `catch` block for the `c.req.arrayBuffer()` guard to `return c.text("Internal Server Error", 500)` instead of `return c.text("ok", 200)`. The safe log line (errorCode-only, no payload/message) was kept unchanged. Rewrote the surrounding comment to drop the "redelivering the same bytes can never succeed" rationale (which does not apply here) and state the actual reasoning: a transient, transport-level failure on an unauthenticated request, which design.md's status policy answers with 500.

### RED Evidence

```
AssertionError: expected 200 to be 500 // Object.is equality
- Expected: 500
+ Received: 200
 ❯ test/http/github-webhook.test.ts:144:24
```

### Files Changed (this correction)

| File | Action | What Was Done |
|------|--------|---------------|
| `test/http/github-webhook.test.ts` | Modified | The "unreadable raw body" test now asserts 500 (was 200) and asserts the exact safe-logged entry; nothing else in the file touched |
| `src/index.ts` | Modified | The `arrayBuffer()` catch block now returns 500 instead of 200; the comment above it no longer cites the malformed-content rationale; nothing else in the file touched |

### New Test Count

- Before this correction: 287 tests passing (35 files)
- After this correction: **287 tests passing** (35 files, unchanged — one existing test modified in place, no test added or removed)
- `npx tsc --noEmit`: clean, no errors

### Status (after correction 2)

The scoped-validator-escalated defect is fixed: an unreadable GitHub webhook body now returns 500 (not 200), matching design.md's status policy for transient/unexpected failures, while still logging only allowlisted fields and never the raw error message. Full suite: `npx vitest run` → 287/287 pass. `npx tsc --noEmit` → clean, no errors. No commit/push made; `.codegraph/` untouched; only the two files named in the maintainer's instruction were touched.
