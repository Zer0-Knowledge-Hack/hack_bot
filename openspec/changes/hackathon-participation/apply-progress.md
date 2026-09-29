# Apply Progress: hackathon-participation

## Batch 1 — Phase 1 Infrastructure (PR1a) — branch `feat/participation-infra`

Mode: Strict TDD. Delivery: stacked-to-main, PR1a (infrastructure unused until PR1b).

Completed: 1.1–1.12 (12/12 of Phase 1). Phases 2–4 pending.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1/1.2 | `test/adapters/migrations.test.ts` | Integration (D1) | 20/20 | 3 failed (no such column) | 23/23 | 3 cases (nullable id, NOT NULL DEFAULT 0, defaults on insert) | None needed |
| 1.3/1.4/1.5 | `test/adapters/d1/hackathon-analysis-repo.test.ts` | Integration (D1) | 13/13 | 13 failed (missing methods/field) | 26/26 | null/stale/mismatch, TTL boundary, race, tenant scope, release, save + persistAnalysis non-clobber | Test ids made per-team (id is the upsert key) |
| 1.6/1.7/1.8 | `test/adapters/telegram/forum-topic-manager.test.ts` | Unit (Api stub) | N/A (new) | module missing | 25/25 | 10 create classes + network/timeout/abort signal; 4 deleted strings, 5 ambiguous incl. non-400 with deleted text, network | None needed |
| 1.9/1.10 | `test/adapters/telegram/chat-publisher.test.ts` | Unit (Api stub) | 21/21 | 5 failed | 26/26 | no-option, empty options, button, 40-char slug ≤64 B, clear ok/400/502 | None needed |
| 1.11 | `test/fakes/index.ts` | Test support | n/a | exercised by PR1b tests | typecheck green | ➖ Triangulation skipped: fakes | ➖ |
| 1.12 | full suite | — | — | — | 916/916, typecheck clean | — | — |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and result | `npx vitest run test/adapters` files above: all green (migrations 23, repo 26, topic manager 25, publisher 26) |
| Runtime harness | N/A: infrastructure unused until PR1b; no fetch/LLM path |
| Rollback boundary | new files + additive columns (ignored on revert); `HackathonAnalysis.generalMessageId` and `ChatPublisher` additions |

### Commits
- `2a2d4c1` docs: exploration, proposal, specs, design, tasks
- `9f2c910` feat(db): migration 0004
- `142b2d7` feat(d1): claim CAS, release, general message id
- `7f7860f` feat(telegram): ForumTopicManager port and adapter
- `27b496a` feat(telegram): clearButtons and participation button

### Deviations / notes
- `HackathonAnalysis.generalMessageId` is a required field, so 12 existing test fixtures gained `generalMessageId: null` (mechanical) and `analyzeHackathon` carries `existing?.generalMessageId ?? null` (SQL upsert never writes it).
- `PARTICIPATE_CALLBACK_PREFIX = "hp:"` is exported from `chat-publisher.ts` so the PR2 handler reuses it.
- Claim uses `topic_claim_until <= now` (an expired-at-now claim can be retaken).
- Fake publisher keeps `posted` shape unchanged; options are logged in a parallel `postOptions` array.
- Fakes (1.11) have no direct tests; they are exercised by the PR1b use-case tests.
