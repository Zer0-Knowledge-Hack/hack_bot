# Proposal: Team Foundation (tenants, members, profiles, access, audit)

## Intent

Teams have no shared, trustworthy registry of who belongs and how to reach them. This change adds the multi-tenant base for a reusable Telegram "team secretary" bot: register teams and members, let members manage their own encrypted profiles, and keep every team's data strictly separate. Team-specific values live in config/data only.

## Scope

### In Scope
- Scaffold: TypeScript, Hono, Wrangler, D1, Vitest + `@cloudflare/vitest-pool-workers` (first task)
- Webhook route that validates `X-Telegram-Bot-Api-Secret-Token`
- `/setup` (group admin, checked once via `getChatMember`) creates the team and seeds the first bot admin
- `/join` in the team group creates a membership; bot-stored role is authoritative afterwards
- Profiles per membership: full name, emails, social links, GitHub username; edited by the member or team admins
- Admin promote/demote
- Member data readable only by same-team members, in the team data topic/linked chat or by DM
- DM team resolution: 0 teams → hint to `/join`; 1 → use it; 2+ → explicit picker, no default
- AES-GCM encryption (WebCrypto) of full name, emails, social links and of their audit old/new values; key from Worker secret; key version per row
- Audit log of every profile/role change (actor, target, field, old, new, timestamp)

### Out of Scope
- GitHub integration, digests/cron, AI/natural language, voice, hackathons (changes 2-4)
- Invite codes, live Telegram admin sync, key-rotation job (schema only supports it)

## Capabilities

### New Capabilities
- `team-registration`: `/setup`, team creation, first-admin bootstrap, data-channel binding
- `team-membership`: `/join`, roles, promote/demote, tenant isolation, DM team resolution
- `member-profiles`: per-membership profile fields, edit permissions, read visibility rules
- `pii-protection`: field encryption, key versioning, no-PII logging
- `audit-log`: change recording with encrypted sensitive values
- `telegram-webhook`: secret-token validation, command-only routing

### Modified Capabilities
- None

## Approach

Hexagonal: framework-free domain use cases with injected ports; grammY as a thin adapter behind a Hono route; D1 shared tables where every team-scoped port method requires `teamId`. A `FieldCipher` port hides WebCrypto. Strict TDD: domain tests first, then D1/adapter tests on vitest-pool-workers.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `package.json`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts` | New | Project and test scaffold |
| `src/domain/` | New | Entities, use cases, ports |
| `src/adapters/telegram/` | New | grammY handlers, DM picker |
| `src/adapters/d1/`, `src/adapters/crypto/` | New | Scoped repositories, AES-GCM cipher |
| `src/index.ts` | New | Hono entry, webhook route |
| `migrations/` | New | teams, members, memberships, profiles, audit_log |
| `test/` | New | Unit and Workers integration tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cross-tenant data leak | Med | Mandatory `teamId` at ports; isolation tests |
| Lost/leaked encryption key | Med | Worker secret, key versioning, documented backup |
| `getChatMember` failure at `/setup` | Med | Fail closed, clear retry message |
| PII in logs | Med | Log IDs/field names only; tests on logger |
| Scope exceeds 400-line review budget | High | Chained PRs planned in tasks |

## Rollback Plan

Greenfield: redeploy the previous Worker version (or delete the webhook via `deleteWebhook`). Migrations are additive; revert by dropping the new tables in a down migration only after exporting data. Never rotate or delete the encryption secret during rollback.

## Dependencies

- Cloudflare account with D1; Telegram bot token; secrets for webhook token and encryption key

## Success Criteria

- [ ] `npm test` passes, including cross-team isolation tests
- [ ] Webhook requests with a wrong/missing secret are rejected
- [ ] Encrypted fields are unreadable in raw D1 rows, including audit rows
- [ ] DM users in 2+ teams must pick a team before any read/write
- [ ] Every profile/role change produces one audit row
- [ ] No team-specific values appear in source
