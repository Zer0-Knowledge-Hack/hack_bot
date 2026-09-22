# Apply Progress: team-foundation

## Result Contract

- **status**: success
- **executive_summary**: PR6 completes tasks 3.5, 3.6, and 3.9: private DM team selection, forged-callback defense, profile command wiring, role command wiring, and data-channel/DM access gating.
- **artifacts**:
  - `src/adapters/telegram/team-picker.ts`
  - `src/adapters/telegram/commands.ts`
  - `test/adapters/telegram/commands.test.ts`
  - `openspec/changes/team-foundation/tasks.md`
  - `openspec/changes/team-foundation/apply-progress.md`
- **next_recommended**: review/start PR6 diff; task 4.1 remains for PR7.
- **risks**: Team labels in the picker are opaque IDs because no team-name field exists. The PR6 diff is 241 additions and 8 deletions, below the 400-line threshold; no size exception is required.
- **skill_resolution**: paths-injected

## Cumulative State

All Phase 0, Phase 1, and Phase 2 work remains complete, including the PR5 webhook, setup/join/data-channel wiring, D1 selection repository, safe logger, and FIX-001/READ-002 correction. PR6 marks tasks 3.5, 3.6, and 3.9 complete. Task 4.1 (`docs/key-backup.md`) is the only remaining task.

## PR6 Work Units

- **3.5**: Callback tests prove forged `sel:<team-id>` selections are refused without persistence, and valid selections persist only after the server rechecks membership.
- **3.6**: `team-picker.ts` accepts selection callbacks only from private chats, validates the callback token, invokes `selectDmTeam`, and stores the 15-minute selection through the existing repository.
- **3.9**: `/profile show`, `/profile set`, `/promote`, and `/demote` use existing domain use cases. DM operations resolve no/one/many team memberships; many memberships produce an explicit picker. Group profile reads use the existing bound-data-topic policy.

## Strict TDD Evidence

| Tasks | RED | GREEN | REFACTOR |
|---|---|---|---|
| 3.5 / 3.6 | The forged-callback test failed because no callback handler replied. | Added the private callback handler; focused tests passed. Added valid-selection triangulation. | Isolated token parsing and private-chat handling in `team-picker.ts`. |
| 3.9 | The outside-data-topic profile-read test failed because `/profile` was unregistered. | Wired commands; focused tests passed. Added in-topic, DM, and role-change triangulation tests. | Shared team-scope and actor-membership resolution helpers. |

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused test + runtime harness | `npm test -- test/adapters/telegram/commands.test.ts` — 16/16 passed. Real grammY `Bot.handleUpdate` with outbound Telegram API transformer stub. |
| Full suite | `npm test` — 24 files, 128/128 passed. |
| Typecheck | `npm run typecheck` — passed. |
| Rollback boundary | Revert `team-picker.ts`, PR6 command/test changes, and tasks/apply-progress artifacts; no Phase 0-2 or PR5 files need removal. |

## Review correction (lineage 2)

Single correction actor applying the frozen review ledger for PR6, on top of 8d0af4a. Each work unit: failing test first, minimal fix, focused test run. WARNING items R1-002, R2-001, R3-003 are explicitly out of scope and untouched.

| WU | Ledger id | Summary | Files touched | Focused test evidence | Rollback boundary |
|---|---|---|---|---|---|
| WU1 | R1-001 | Product decision (SHARED DIRECTORY): `/profile show` (no arg) returns the whole team directory grouped by member, each block naming the owner (membership id, github_username/full_name if set) and role (from `membershipRepo`); `/profile show <id>` returns one member. Aligned pii-protection spec's "authorized reader" wording to "any registered member of the same team (in the data channel or DM)". | `src/adapters/telegram/commands.ts`, `openspec/changes/team-foundation/specs/pii-protection/spec.md`, `test/adapters/telegram/commands.test.ts` | 3 new tests in `describe("registerCommands — /profile show team directory (R1-001)")` — directory grouped by member with roles, single-member filter, `unreadable` rendering. All pass. | Revert the 3 files above; no port/entity/D1 changes were needed (existing `membershipRepo.listByTeam`/`get` and `profileRepo.list` sufficed). |
| WU2 | R3-002 | `resolveCommandTeam`'s group branch no longer returns `null` silently when the chat has no team: it now replies "No team is registered for this chat. Ask an admin to run /setup." (same text as `/join`) and logs a `refused` outcome, for `/profile`, `/promote`, `/demote`. | `src/adapters/telegram/commands.ts`, `test/adapters/telegram/commands.test.ts` | 3 new tests (one per command) in `describe("registerCommands — no team registered for the chat (R3-002/R4-002)")` asserting reply text and `logger.log` call with `outcome: "refused"`. All pass. | Revert `commands.ts`/test changes for this describe block; independent of WU1/WU3-5. |
| WU3 | R4-002 | `resolveCommandTeam`'s D1 reads (`teamRepo.findByChatId`, `resolveDmTeam`) now run inside a try/catch that logs an `error` outcome (errorCode only) and rethrows on any unrecognized failure — same recognized-vs-rethrown shape as `runCommand`/FIX-001 — instead of failing unlogged outside any boundary. | `src/adapters/telegram/commands.ts`, `test/adapters/telegram/commands.test.ts` | 1 new test: `teamRepo.findByChatId` throwing during `/profile` team resolution is logged (`outcome: "error"`) and the webhook update rejects (`rejects.toMatchObject({ error: failure })`). Passes. | Same files as WU2; revert together or independently (same function, additive try/catch). |
| WU4 | R3-001 | Added command-level coverage (no code bug found; existing `resolveDmTeam`/`selectDmTeam` behavior was already correct) for the DM picker across `/profile`, `/promote`, `/demote`: picker shown for 2+ memberships, a &lt;15-minute selection is remembered, and both an expired (&gt;15 min, injected clock) and a lost-membership selection (with 2+ remaining teams, per spec:74-78) re-trigger the picker. | `test/adapters/telegram/commands.test.ts` | 6 new tests in `describe("registerCommands — DM team picker for /profile, /promote, /demote (R3-001)")`. All pass; no production code changed for this WU. | Revert the added `describe` block only; test-only change. |
| WU5 | R4-001, R4-003 | `team-picker.ts`: added `Logger` to `TeamPickerDeps` and logs every outcome (`ok`/`refused`/`error`, IDs/errorCode only, no PII) through the same safe-logger shape as `runCommand`. Broke the retry loop: once `selectDmTeam` persists successfully, `answerCallbackQuery`/`reply` failures (e.g. an already-answered/expired replayed callback) are caught, logged, and never rethrown — the selection is already durable. `dmSelectionRepo.set` failures (not `UnauthorizedError`) still rethrow unchanged. | `src/adapters/telegram/team-picker.ts`, `src/adapters/telegram/commands.ts` (passes `deps.logger` through, already present on `CommandDeps`), `test/adapters/telegram/commands.test.ts` | 2 new tests in `describe("registerCommands — DM team picker outbound failures (R4-001/R4-003)")`: `answerCallbackQuery` returning `ok:false` (grammY throws `GrammyError`) does not propagate and is logged; `sendMessage` (reply) returning `ok:false` after a successful selection does not propagate and is logged. The pre-existing "rethrows an unexpected selection persistence failure" test still covers the `dmSelectionRepo.set`-still-rethrows case unchanged. All pass. | Revert `team-picker.ts` and the new outbound-failure describe block in the test file; `commands.ts` needed no change since `CommandDeps` already had `logger`. |

### Full-suite and typecheck evidence (post-correction)

- `npx vitest run` — 24 files, **144/144 passed** (was 128 before this correction; +16 new tests across WU1-WU5, net of 1 test-design fix during WU4 — see below).
- `npx tsc --noEmit` — **passed**, no errors.
- `git diff --stat` (working tree vs 8d0af4a, excluding `.codegraph/`): `commands.ts` +191/-? lines, `test/adapters/telegram/commands.test.ts` +353 lines, `pii-protection/spec.md` 1 line changed, `tasks.md` unchanged by this correction (pre-existing diff from prior session).

**Note (WU4 self-correction, not a ledger item):** the first draft of the "lost membership" picker test removed the selected team's only membership, leaving the caller with exactly one remaining membership — which correctly auto-resolves per spec ("Caller has exactly one team"), not the "needs-selection" case being tested. Fixed by giving the caller three teams so 2+ memberships remain after losing the selected one, matching team-membership spec:74-78 exactly. No production code was wrong; the test scenario was corrected before it was trusted.
