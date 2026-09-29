# Apply Progress: spanish-copy

Mode: Strict TDD. Artifact store: hybrid. Branch: `feat/spanish-copy-hackathon` (from `main` 9caa453). Not pushed.

## Phase 1 (PR1): Domain Catalog + Hackathon — COMPLETE (1.1-1.10, merged as #39)


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

## Phase 2 (PR2): Profile, Team, Membership, Repo Commands + Picker — COMPLETE (2.1-2.7)

Branch: `feat/spanish-copy-commands` (from `main` c4e7248). Not pushed.

### Commits

| Hash | Message |
|------|---------|
| 04d7a0d | feat(copy): extend Telegram adapter catalog with profile, team, repo and picker copy |
| 719a45d | feat(copy): translate profile, team, membership, repo commands and team picker to Spanish |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `test/adapters/telegram/commands.test.ts` | Integration | Full suite green before (71 files, 828 tests) | Exact Spanish assertions for /setup, /join, /datachannel, /profile, /promote, /demote, /linkrepo, /unlinkrepo, /repos, team resolution; role labels; `/…y d+ más$/`; 9 new cases | Passed | Many per-command cases | None needed |
| 2.2 | same file (picker tests live in `commands.test.ts`; no separate picker file exists) | Integration | Same | Callback alert text (via new `alerts` capture), reply, "Equipo {id}" buttons; failed | Passed | Forged callback, valid selection, button labels | None needed |
| 2.3 | `test/copy/catalog-language.test.ts` | Unit | Same | Imports missing catalogs; 12 failed | Passed | Denylist + non-empty per catalog, `ROLE_LABELS`, link/unlink map, shared phrases | None needed |
| 2.4 | `src/adapters/telegram/copy.ts` | Unit | Same | Covered by 2.1-2.3 | Passed | Yes | None needed |
| 2.5 | `src/adapters/telegram/commands.ts` | Integration | Same | Covered by 2.1 | Passed | Yes | `reposReply` delegates to `joinLinesWithinLimit`; removed `REPOS_REPLY_MAX` and duplicate loop |
| 2.6 | `src/adapters/telegram/team-picker.ts` | Integration | Same | Covered by 2.2 | Passed | Yes | None needed |
| 2.7 | full suite | - | - | - | 71 files, 857 tests pass; `npm run typecheck` clean | - | - |

RED run: 51 failed / 76 passed in `test/adapters/telegram`, plus 12 failed in `test/copy`.

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `npm test -- test/adapters/telegram test/copy`: RED 51 + 12 failed; GREEN after implementation. Full `npm test`: 857/857 |
| Runtime harness | N/A: copy only |
| Rollback boundary | `commands.ts`, `team-picker.ts`, the PR2 additions in `src/adapters/telegram/copy.ts` |

### Deviations / notes

- No dedicated team-picker test file exists; picker cases live in `commands.test.ts`, so they were extended there.
- `test/http/webhook-e2e.test.ts` also asserted `/created/i` on the /setup reply; updated to the Spanish string (out of the listed files, required by the copy change).
- Catalog shape: `ROLE_LABELS`, `teamResolutionCopy`, `setupCopy`, `joinCopy`, `dataChannelCopy`, `profileCopy`, `roleCopy`, `repoCopy` (`topicRequired` is `Record<"link"|"unlink">`), `pickerCopy`; `commonCopy` gained `noTeamForChat` and `membershipCheckFailed(cmd)`.
- "Permanecer anónimo" used as the design assumed.
- Leftover-English grep over Phase 2 reply paths: only domain exception messages (`NotFoundError`/`UnauthorizedError` args, never shown) and log event names remain.
- Size: 6 files, +368 / -128 (src about 129 net lines changed in commands.ts/picker plus 87 catalog; rest tests).

## Phase 3 (PR3): GitHub Alerts — COMPLETE (3.1-3.5)

Branch: `feat/spanish-copy-github` (from `main` 2152a2d). Not pushed.

### Commits

| Hash | Message |
|------|---------|
| ecdbb3b | feat(copy): add Spanish GitHub alert header catalog |
| ce8d7f6 | feat(copy): translate GitHub alerts to Spanish |

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `test/domain/github.test.ts` | Unit | Full suite green before (71 files, 857 tests) | Exact Spanish output, "Revisor:"/"Por:", `it.each` over all 8 kind:action combos (no raw codes, <=4096); 10 failed | Passed | 8 combos + reviewer present/absent + merged exact output | None needed |
| 3.2 | `test/copy/catalog-language.test.ts` | Unit | Same | `GITHUB_ALERT_HEADERS` and `githubCopy` added to catalogs, 8-key check; 3 failed | Passed | Denylist + non-empty + key set + labels | None needed |
| 3.3 | `src/domain/copy.ts` | Unit | Same | Covered by 3.1/3.2 | Passed | Yes | None needed |
| 3.4 | `src/domain/github.ts` | Unit | Same | Covered by 3.1 | Passed | Yes | None needed |
| 3.5 | full suite | - | - | - | 71 files, 870 tests pass; `npm run typecheck` clean | - | - |

### Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test command | `npm test -- test/domain/github.test.ts test/copy`: RED 10 + 3 failed; GREEN after implementation. Full `npm test`: 870/870 |
| Runtime harness | N/A: copy only |
| Rollback boundary | `src/domain/github.ts` and the GitHub section of `src/domain/copy.ts` |

### Deviations / notes

- `test/adapters/github/event-mapper.test.ts` asserts mapped domain events (kind/action codes), never alert text, so it needs no Spanish assertion and was left unchanged.
- `src/domain/copy.ts` imports `GithubEventKind`/`GithubEventAction` as types from `./github` while `github.ts` imports the catalog values: type-only, so no runtime cycle.
- `githubCopy` (`reviewerLabel`, `byLabel`) added next to `GITHUB_ALERT_HEADERS`.
- Size: src +28/-3 lines (2 files), tests +46/-9 (2 files).

## Phase 4: Final Verification — COMPLETE (4.1-4.2)

- 4.1 Leftover-English grep over `src/` (comments excluded) across every reply path (`ctx.reply`, `answerCallbackQuery`, `chatPublisher.post`, alert sender, `format*`): no user-visible English copy. Matches remaining are only (a) domain exception messages (`UnauthorizedError`/`NotFoundError`/`ConfigError` args), (b) log event names, (c) import paths containing "topic", (d) the intentional `/profile set` field keys. Verified (a) never reach users: `runCommand` replies only with `errorReplies[err.name]` (Spanish catalog strings) and logs `err.name`/declared reason; unrecognized errors are rethrown, and there is no `bot.catch` sending text. `err.message` is used only in logs (`ConfigError` reason) and internal regexes. HTTP bodies ("Unauthorized", "Internal Server Error", "ok") go to Telegram/GitHub servers, not chat users.
- 4.2 `prompt.test.ts` unchanged (`git diff main` does not touch it). Full `npm test`: 71 files, 870 tests pass. `npm run typecheck` clean.

### Remaining

None. All tasks (1.1-4.2) complete; next: sdd-verify.
