# Apply Progress: spanish-copy

Mode: Strict TDD. Artifact store: hybrid. Branch: `feat/spanish-copy-hackathon` (from `main` 9caa453). Not pushed.

## Phase 1 (PR1): Domain Catalog + Hackathon — COMPLETE (1.1-1.10)

Phases 2 and 3 pending.

### Commits

| Hash | Message |
|------|---------|
| 5b2794e | feat(copy): add Spanish domain catalog for analysis formatting and truncation |
| 65438c6 | feat(copy): use Spanish catalog in hackathon job, link and request use cases |
| 4e5ff40 | feat(copy): translate /hackathon replies via adapter catalog and add language guard |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `test/domain/text-limit.test.ts` | Unit | Full suite green before (baseline 71 files) | Written, failed | Passed | Single (regex only) | None needed |
| 1.2 | `test/domain/hackathon/format.test.ts` | Unit | Same baseline | Written (all 11 labels in order, list markers, empty list), failed | Passed | 3 cases | None needed |
| 1.3 | `test/domain/usecases/{run-hackathon-job,link-analysis-to-topic,list-analyses,request-hackathon-analysis}.test.ts` | Unit | Same baseline | Written (exact outcomes, notes, 6 fetch phrases via `it.each`, too-thin, quota, invalid output, config), failed | Passed | 6 fetch kinds + 4 outcome cases | None needed |
| 1.4 | `test/index.queue.test.ts`, `test/http/hackathon-command-e2e.test.ts`, `test/adapters/telegram/commands.test.ts` (hackathon cases) | Unit / Integration | Same baseline | Written (57 failures across 10 files at first RED run), failed | Passed | Ack, usage, refusals, cap, busy, enqueue failure, link ack, notes | None needed |
| 1.5 | `test/copy/catalog-language.test.ts` | Unit | N/A (new) | Written first (imports missing catalogs), failed | Passed | Denylist + non-empty per catalog, fetch map keys, label order | None needed |
| 1.6 | `src/domain/copy.ts` | Unit | N/A (new) | Covered by 1.1-1.5 | Passed | Via 1.2/1.3/1.5 | None needed |
| 1.7 | `format.ts`, `text-limit.ts` | Unit | Baseline | Covered by 1.1/1.2 | Passed | Yes | Removed local constants |
| 1.8 | three use cases | Unit | Baseline | Covered by 1.3 | Passed | Yes | None needed |
| 1.9 | `src/adapters/telegram/{copy,hackathon-commands}.ts` | Integration | Baseline | Covered by 1.4/1.5 | Passed | Yes | Removed `USAGE`/`GROUP_ONLY` constants |
| 1.10 | full suite | - | - | - | 71 files, 828 tests pass; `npm run typecheck` clean | - | - |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `npm test -- test/domain test/copy test/index.queue.test.ts test/http/hackathon-command-e2e.test.ts test/adapters/telegram/commands.test.ts`. RED: 57 failed / 347 passed. GREEN then: 828/828 after two test-side fixes (see below) |
| Runtime harness | N/A: copy only; fetch, LLM and validation logic unchanged |
| Rollback boundary | `src/domain/copy.ts`, `src/adapters/telegram/copy.ts`, the call sites in `format.ts`, `text-limit.ts`, the three use cases and `hackathon-commands.ts` |

### Files changed

- Created: `src/domain/copy.ts`, `src/adapters/telegram/copy.ts`, `test/copy/catalog-language.test.ts`
- Modified src: `src/domain/hackathon/format.ts`, `src/domain/text-limit.ts`, `src/domain/usecases/{run-hackathon-job,link-analysis-to-topic,request-hackathon-analysis}.ts`, `src/adapters/telegram/hackathon-commands.ts`
- Modified tests: `test/domain/{text-limit,hackathon/format}.test.ts`, `test/domain/usecases/{run-hackathon-job,link-analysis-to-topic,list-analyses,request-hackathon-analysis}.test.ts`, `test/index.queue.test.ts`, `test/http/hackathon-command-e2e.test.ts`, `test/adapters/telegram/commands.test.ts`

### Deviations / notes

- `http-status` phrase is "el sitio respondió con un error", per the openspec files.
- Domain exception messages (e.g. `UnauthorizedError("Only a team admin may ...")`) stay English: they never reach users (adapters map errors by name) and the spec keeps them unchanged.
- The `/repos` "...and N more" line and its test are unchanged in PR1 (`reposReply` is PR2), as the design allows.
- Post-GREEN fixes on the test side: one e2e assertion (`could not start`) was missed in RED, and the `teamSize` fixture needed a numeric value to typecheck.
- Adapter catalog shape: `commonCopy` (`notMember`, `linkedHere`) and `hackathonCopy` (usage, groupOnly, adminOnly, noAnalysis, unsafeUrl, urlTooLong, dailyCap, busy, queueSendFailed, notConfigured, publishFailed).
- Leftover-English grep over the Phase 1 reply paths: only exception messages and comments remain.
- Size: about 192 src lines changed (131 added, 61 removed) and 334 test lines changed (277 added, 57 removed); above the ~260 forecast because of the added tests.

### Remaining

Phase 2 (2.1-2.7), Phase 3 (3.1-3.5), Phase 4 (4.1-4.2).
