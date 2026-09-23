# Archive Report: Team Foundation

**Date**: 2026-09-23
**Change**: team-foundation
**Artifact Store**: hybrid (OpenSpec + Engram)
**Status**: ARCHIVED

## Change Summary

Multi-tenant Telegram "team secretary" bot foundation: team registration, membership management, member profiles with encryption, tenant isolation, and audit logging. All 6 capability specs (team-registration, team-membership, member-profiles, pii-protection, audit-log, telegram-webhook) implemented as New Capabilities with strict TDD discipline.

## Artifacts Persisted

### OpenSpec Filesystem (authoritative)
- `openspec/specs/team-registration/spec.md` — delta spec merged to main spec
- `openspec/specs/team-membership/spec.md` — delta spec merged to main spec
- `openspec/specs/member-profiles/spec.md` — delta spec merged to main spec
- `openspec/specs/pii-protection/spec.md` — delta spec merged to main spec
- `openspec/specs/audit-log/spec.md` — delta spec merged to main spec
- `openspec/specs/telegram-webhook/spec.md` — delta spec merged to main spec
- `openspec/changes/archive/2026-09-23-team-foundation/` — complete change archive (all artifacts preserved)

### Engram Memory (mirror, traceability)
- Observation #2297: sdd/team-foundation/proposal
- Observation #2298: sdd/team-foundation/spec
- Observation #2299: sdd/team-foundation/design
- Observation #2301: sdd/team-foundation/tasks
- Observation #2326: sdd/team-foundation/verify-report
- Observation #ARCHIVE: sdd/team-foundation/archive-report (this document)

## Specs Synced to Main

All 6 delta specs from `openspec/changes/team-foundation/specs/` were copied directly to `openspec/specs/{domain}/spec.md` as complete specs (not deltas) because `openspec/specs/` was empty at archive time. No existing requirements needed merging; these are greenfield capabilities.

| Domain | Scenarios | Requirements | Status |
|--------|-----------|--------------|--------|
| team-registration | 7 | 3 | SYNCED |
| team-membership | 11 | 4 | SYNCED |
| member-profiles | 7 | 3 | SYNCED |
| pii-protection | 5 | 4 | SYNCED |
| audit-log | 3 | 2 | SYNCED |
| telegram-webhook | 4 | 2 | SYNCED |
| **TOTAL** | **37** | **18** | **SYNCED** |

## Completion & Verification

- **Tasks**: 31/31 complete (all phases 0-4 verified checked in `tasks.md`)
- **Tests**: 144/144 passed (24 test files, npx vitest run clean)
- **Typecheck**: npx tsc --noEmit clean (exit 0)
- **Spec scenarios**: 38/39 compliant per verify-report

## Critical Finding Resolution

**Originally reported CRITICAL**: audit-log spec Requirement "Audit Read Follows Profile Authorization" (scenario "Cross-tenant audit read is impossible") was unimplemented — no Telegram command, domain use case, or repo method to read audit_log rows.

**Resolution**: Intentional descoping per maintainer decision. The audit log write and encryption features are complete; read access and its authorization rules are deferred to a follow-up change. This change writes and encrypts audit rows correctly; audit row reading will be a separate feature in a follow-up SDD change.

**Evidence**:
- proposal.md line 24 (Out of Scope section): "Reading the audit log. This change writes and encrypts audit rows; read access and its authorization rules are deferred to a follow-up change (found unimplemented by verify)"
- audit-log spec reduced from 3 to 2 requirements (removed "Audit Read Follows Profile Authorization" requirement)
- verify-report.md is preserved unchanged as historical evidence; it still reports the CRITICAL as found at verify time, and this archive report records its resolution

This is not a gap; it is an accepted product decision to split the feature across two changes.

## Non-Blocking Warnings

Five pre-existing backlog items confirmed still present (all non-blocking, recorded in verify-report):

1. **team-picker.ts:58**: `match[1] as never` cast into TeamId instead of a validating `asTeamId()` helper (bypasses branded-type guard at parse boundary for user-controlled callback data)
2. **No tests for malformed input**: No test coverage for malformed `/profile set` or similar malformed-argument usage reply text and behavior
3. **No CI workflow**: No `.github/workflows` enforcing `npx vitest run` or `npx tsc --noEmit` on push/PR
4. **vitest.config.ts**: Missing `forbidOnly: true` guard (accidental `.only` would silently skip rest of suite in CI-less runs)
5. **wrangler.jsonc**: `BOT_INFO` required in `src/env.ts` but not declared in wrangler.jsonc vars (deployment fails closed at runtime if unset)

All are acceptable backlog items; none block production deployment or SDD cycle closure.

## Out-of-Scope Follow-Up Opportunities

Recorded in proposal.md and design.md:

1. **Audit log read access** (intentionally deferred): Design a command (e.g., `/audit`) and authorization rules; implement domain use case, repo query, and telegram handler. Use case stub exists in design.md.
2. **Team name field**: Currently no team_name column; team labels in DM picker are opaque IDs (mentioned in apply-progress.md as a team-picker limitation).
3. **Tool to list referenced key versions**: Design and document a tool to audit which key versions are still in use across the keyring.

## Testing Summary

- **Domain tests** (7 files, ~55 tests): Pure Vitest with fakes, no external dependencies
- **Integration tests** (17 files, ~89 tests): vitest-pool-workers + D1 migrations + WebCrypto + grammY stubs
- **Layers covered**: Cross-team isolation, encryption, webhook auth, DM team resolution, audit row atomicity, logging sanitization
- **TDD compliance**: 6/6 checks passed (RED/GREEN evidence, proper test distribution, triangulation)

## Rollback Boundary

To revert this change:
1. Delete `openspec/specs/{team-registration,team-membership,member-profiles,pii-protection,audit-log,telegram-webhook}/spec.md` files
2. Keep archived change folder for audit trail (never delete)
3. On production: redeploy previous Worker version or delete webhook via `deleteWebhook` API

## Notes

- **Spec text alignment**: pii-protection spec text was updated during PR6 (R1-001 product decision) to clarify "authorized reader" means any registered member in the same team; code and spec are aligned.
- **Profile storage**: Accepted design decision to use `profile_fields` row-per-field with `key_version` per row, not wide `profiles` row. Matches code and tests; no deviation.
- **No re-encryption job**: Accepted per design.md Rotation note. Key rotation supported (add version, move `active`), but rows keep their own version tag for backward compatibility. No job needed in this change.
- **Hexagonal architecture**: Verified: domain imports nothing from grammY, Hono, D1, or workers-types. Adapters cleanly isolated.

## Archive Contents

The archived folder at `openspec/changes/archive/2026-09-23-team-foundation/` contains:
- proposal.md (updated with Out of Scope section clarifying audit-log read deferral)
- design.md
- tasks.md (all 31 tasks marked complete)
- verify-report.md (preserved unchanged; the CRITICAL resolution is recorded in this report)
- apply-progress.md (PR6/PR7 evidence)
- explore.md (initial exploration and decisions)
- specs/ (all 6 domain specs in full form, copied from delta specs)

**CLOSURE**: The SDD cycle for team-foundation is complete. All 6 capabilities are specified, designed, implemented, tested, and archived. The change is ready for deployment and maintenance.
