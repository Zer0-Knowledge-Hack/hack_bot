## Exploration: Multi-tenant Telegram "team secretary" bot — foundation (tenants, members, profiles, access, audit)

> Mirror of Engram `sdd/team-foundation/explore` (id 2294).

### Current State
Repo `hack_bot` is greenfield: only `LICENSE`, `README.md`, and an `openspec/` skeleton. No source code exists yet. `openspec/config.yaml` records the planned stack (TypeScript, Cloudflare Workers, Hono, D1, Workers AI, Cron Triggers — AI/Cron are out of scope for this change), strict TDD, and the constraint that team-specific data must live in config/data, never hardcoded. Vitest + `@cloudflare/vitest-pool-workers` is planned but not installed.

### Target Areas (greenfield)
- `src/` — Hono app entry, Workers `fetch` handler, webhook route
- `src/domain/` — tenant, member, profile, audit-log entities and use cases, framework-free
- `src/adapters/telegram/` — Telegram API client, update parsing, command router
- `src/adapters/d1/` — repositories implementing domain ports against D1
- `migrations/` — D1 schema (teams, members, memberships, profiles, audit_log)
- `wrangler.toml` — Workers config, D1 binding, secrets (webhook secret token, bot token)
- `test/` — Vitest + vitest-pool-workers setup

### Telegram API specifics (verified against core.telegram.org/bots/api)

1. **Webhook + secret validation**: `setWebhook` accepts `secret_token` (1-256 chars, `A-Z a-z 0-9 _ -`). Telegram sends it on every webhook POST as header `X-Telegram-Bot-Api-Secret-Token`. The Worker MUST reject requests where this header does not match a Workers secret — it is the only authentication for inbound webhook calls.
2. **Forum topics as "data channel"**: a supergroup has `is_forum: true` when topics are enabled. Each `Message` carries `message_thread_id` and `is_topic_message: true` inside a topic. Store the team's `data_topic_thread_id` (or a linked `data_chat_id`) and restrict member-data commands/replies to it.
3. **Privacy mode**: enabled by default — the bot only receives commands, replies to its own messages, and service messages. All interactions in this change are command-driven, so privacy mode stays enabled and the bot does not need group admin rights.
4. **DM vs group, multi-team resolution**: in a private chat there is no group context, so the bot looks up the caller's memberships. 0 teams → tell the user to `/join` in a team group. 1 team → operate on it. 2+ teams → inline-keyboard team picker (`callback_data` encodes the team). The bot MUST NOT silently default to a "last used" team.
5. **Group admin status**: `getChatMember(chat_id, user_id)` returns `ChatMemberAdministrator` / `ChatMemberOwner` for admins. Use it once at `/setup` to bootstrap the first bot admin; the bot-stored role is the source of truth afterwards.

### Registered member & team admin
- **Registered member**: a row in `memberships(team_id, member_id)`, created by `/join` run inside the team group. No invite codes in v1.
- **Team admin**: bot-level role `memberships.role IN ('member','admin')`. The user who runs `/setup` while being a Telegram group admin becomes the first admin; admins promote/demote others via commands, all audited.
- Rejected for v1: invite codes; live Telegram admin sync on every request.

### D1 multi-tenant schema
**Chosen: one D1 database, shared tables with `team_id` + composite indexes.** Database-per-tenant adds heavy operational overhead for many small groups.

- `teams(id, telegram_chat_id UNIQUE, data_topic_thread_id NULL, created_at)`
- `members(id, telegram_user_id UNIQUE, created_at)` — global identity
- `memberships(id, team_id, member_id, role, joined_at, UNIQUE(team_id, member_id))`
- `profiles(...)` — **open question**: per-membership (team-scoped) vs global per member
- `audit_log(id, team_id, actor_member_id, target_member_id, field, old_value, new_value, changed_at)`

**Enforcement**: every repository method touching memberships, profiles, or audit_log takes `teamId` as a mandatory parameter and filters by it; tests assert cross-tenant queries return nothing.

**PII handling**: stored in plaintext in D1 (must be readable back). Never log PII values (only IDs/field names). Audit log values are sensitive and follow the same authorization as profile reads. Application-level encryption is a future hardening option.

### Library: grammY vs raw fetch + Hono

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| grammY | Typed updates, command routing, Workers webhook adapter, fewer parsing bugs | Extra dependency; must be kept out of the domain | Low-Med |
| Raw fetch + Hono | No dependency, full control | Reinvents update parsing, callbacks, validation | Med |

**Recommendation**: grammY as a thin edge adapter behind a Hono route that validates the secret token. The domain never imports grammY.

### Architecture (hexagonal)
- **Domain**: entities + use cases (`RegisterMember`, `UpdateProfileField`, `ListTeamMembers`, `PromoteToAdmin`) with injected ports. No grammY/Hono/D1 imports.
- **Ports**: repository interfaces.
- **Adapters**: `telegram/` (grammY handlers, DM team picker), `d1/` (tenant-scoped repositories).
- **Entry**: Hono app wiring.

Strict TDD: pure domain tests first, then adapter tests with vitest-pool-workers + D1 migrations.

### Recommendation
grammY + Hono, shared-table multi-tenancy with mandatory team scoping at the port level, membership-scoped profiles, `getChatMember` only at setup, command-only interaction under default privacy mode.

### Risks
- Profile scope is a design fork that must be decided before spec.
- DM multi-team resolution needs an explicit "no default team" testable requirement.
- `/setup` depends on a live `getChatMember` call; needs failure handling.
- Plaintext PII at rest in D1 must be an explicitly accepted risk.

### Decisions resolved with the user (post-exploration)
1. Profile scope: **per team membership**.
2. PII: **application-level AES-GCM encryption from day one** (full name, emails, social links); GitHub username stays plaintext. This supersedes the plaintext-at-rest assumption above.
