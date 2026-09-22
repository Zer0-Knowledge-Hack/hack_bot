# Design: Team Foundation

## Technical Approach

Hexagonal Worker. `src/domain` holds entities, access policy, use cases and ports, and imports nothing from grammY, Hono, D1 or workers-types. Adapters implement ports: `d1/` (tenant-scoped repositories), `crypto/` (WebCrypto AES-GCM key ring), `telegram/` (a thin grammY layer that turns updates into use-case calls). `src/index.ts` is the Hono entry: it checks the webhook secret and then hands the request to grammY's `webhookCallback`. Deployment-specific data comes from bindings/secrets. Team data lives in D1 rows. No team-specific values in source. This change uses no Workers AI or Cron.

## Architecture Decisions

| Topic | Choice | Rejected (tradeoff) |
|---|---|---|
| Tenancy | One D1, shared tables. `TeamId` is a branded type and the required first parameter of every tenant-scoped port method. Composite FKs `(team_id, membership_id)` | DB per team (ops overhead); scoping by convention only (leaks are easy) |
| Profile storage | `profile_fields` row per (membership, field), with `key_version` per row. Lists (emails, social links) are stored as one encrypted JSON value | Wide `profiles` row (whole row re-encrypted on every edit; mixes plaintext and ciphertext columns) |
| Ciphertext binding | AES-GCM-256, 12-byte random IV, AAD = `table|teamId|rowKey|field` | No AAD (a ciphertext could be moved between rows or tenants undetected) |
| Key ring | Secret `PII_KEYRING` = `{"active":n,"keys":{"n":"<b64 32B>"}}`. Encrypt with `active`, decrypt with any listed key. If the secret is missing or malformed, fail closed | One key (cannot rotate); KMS (not native to Workers) |
| Atomicity | Write ports persist the change and its audit row in one `DB.batch()` (transactional) | UnitOfWork port (too abstract for D1 batch semantics) |
| Admin bootstrap | `ChatAdminChecker` port is called once in `/setup`. Error or timeout means refuse. After that, the stored role is authoritative | Live sync (API calls on every request, extra failure modes) |
| Data channel | Domain `DataChannel = {kind:'topic',chatId,threadId}` union. Only `topic` is implemented (`teams.data_topic_thread_id`). A `linkedChat` variant can be added later with an additive `data_chat_id` column | Implementing both now (scope) |
| DM team choice | Inline picker. `callback_data = "sel:<teamUuid>"` (40 B). The server re-checks membership. The selection is stored in `dm_selections` with a 15-minute TTL and re-checked on every use | Trusting the callback's team id (spoofable); last-used default (forbidden) |
| Webhook auth | Constant-time comparison (`crypto.subtle.timingSafeEqual`, length checked first) before the body is parsed; 401 on mismatch | `===` comparison (timing leak) |
| Telegram lib | grammY limited to `adapters/telegram`, with `botInfo` taken from a `BOT_INFO` var (no `getMe` per request) | Raw fetch (hand-written update parsing) |
| Logging | `Logger` port with an allowlisted field set (`event, teamId, membershipId, field, outcome, errorCode`). Update text and values are never logged | Free-form `console.log` |

## Data Flow

```
Telegram ─POST /telegram/webhook─> Hono(secret check) ─> grammY ─> handler
  handler: build Context{chat, thread, fromUserId} ─> use case(ports)
  use case ─> AccessPolicy ─> Repos(D1) / FieldCipher(AES-GCM) ─> reply text
```

Key sequences:

- **/setup** (supergroup): team already exists for this chat → refuse. `ChatAdminChecker.isAdmin` fails or returns false → refuse. Otherwise one batch: insert team, upsert member, insert admin membership, write audit row `role: null→admin`.
- **/datachannel** (inside a forum topic, sender is a team admin): set `data_topic_thread_id` and write an audit row.
- **/join** (team group): upsert member, then insert membership `role=member` with an audit row. The insert is idempotent through a UNIQUE constraint, so retries are safe.
- **Profile edit** (DM): resolve the team scope. Policy: actor is the target, or actor is an admin. Encrypt with the active key, then one batch that upserts the field and writes an audit row (old/new encrypted).
- **DM read**: memberships count 0 → hint to `/join`. Count 1 → use that team. Count 2+ → require a valid selection, otherwise show the picker. On callback: strict regex parse, confirm private chat, confirm membership exists → store the selection. Then decrypt and reply. In a group, reads are allowed only inside the data topic.

## File Changes

| Path | Action | Description |
|---|---|---|
| `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts` | Create | Scaffold, D1 binding `DB`, migrations read for tests |
| `src/index.ts` | Create | Hono: `POST /telegram/webhook`, `GET /health` |
| `src/composition.ts` | Create | Wires env → adapters → use cases for each request (no module-level state) |
| `src/domain/{ids,entities,errors,ports,access-policy}.ts` | Create | Types, pure policy (includes the "last admin cannot be demoted" rule) |
| `src/domain/usecases/*.ts` | Create | setup-team, bind-data-channel, join-team, update-profile-field, change-role, read-profiles, resolve-dm-team, select-dm-team |
| `src/adapters/d1/*-repo.ts` | Create | Tenant-scoped SQL (`WHERE team_id = ?` always) |
| `src/adapters/crypto/{key-ring,aes-gcm-cipher}.ts` | Create | FieldCipher implementation |
| `src/adapters/telegram/{bot,commands,context,team-picker,chat-admin-checker}.ts` | Create | grammY edge |
| `src/adapters/log/safe-logger.ts` | Create | Allowlist logger |
| `migrations/0001_init.sql` | Create | Schema below |
| `test/{domain,adapters,http}/`, `test/fakes/` | Create | Tests and in-memory fakes |

Schema (`0001_init.sql`, TEXT UUID ids, epoch-ms ints):

```sql
teams(id PK, telegram_chat_id INTEGER UNIQUE NOT NULL, data_topic_thread_id INTEGER NULL, created_at)
members(id PK, telegram_user_id INTEGER UNIQUE NOT NULL, created_at)
memberships(id PK, team_id FK, member_id FK, role CHECK(role IN('member','admin')), joined_at,
  UNIQUE(team_id, member_id), UNIQUE(team_id, id))
profile_fields(team_id, membership_id, field CHECK(field IN('full_name','emails','social_links','github_username')),
  value BLOB NOT NULL, key_version INTEGER NULL /* NULL = plaintext */, updated_at,
  PRIMARY KEY(team_id, membership_id, field), FOREIGN KEY(team_id, membership_id) REFERENCES memberships(team_id, id))
audit_log(id PK, team_id, actor_membership_id, target_membership_id, field, old_value BLOB, new_value BLOB,
  key_version INTEGER NULL, created_at, FKs composite as above); INDEX(team_id, target_membership_id, created_at)
dm_selections(telegram_user_id PK, team_id FK, expires_at)
```

## Interfaces / Contracts

```ts
type TeamId = string & { readonly __brand: 'TeamId' };
interface MembershipRepo {
  findByUser(telegramUserId: number): Promise<Membership[]>;          // cross-team only for DM resolution
  get(teamId: TeamId, membershipId: MembershipId): Promise<Membership | null>;
  changeRole(teamId: TeamId, change: RoleChange, audit: AuditDraft): Promise<void>;
}
interface ProfileRepo {
  list(teamId: TeamId, membershipId?: MembershipId): Promise<StoredField[]>;
  upsertField(teamId: TeamId, field: StoredField, audit: AuditDraft): Promise<void>;
}
interface FieldCipher {
  encrypt(plain: string, aad: string): Promise<{ value: Uint8Array; keyVersion: number }>;
  decrypt(value: Uint8Array, keyVersion: number, aad: string): Promise<string>; // throws FieldUnreadable
}
interface ChatAdminChecker { isAdmin(chatId: number, userId: number): Promise<boolean>; } // throws on API failure
```

Also defined: `TeamRepo`, `MemberRepo`, `DmSelectionRepo`, `Clock`, `IdGen`, `Logger`.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Domain (written first) | Policy, use cases, DM resolution, last-admin rule | Pure Vitest with fakes and a fake cipher |
| D1 adapters | Queries, batches, cross-team isolation, FK rejection | vitest-pool-workers. Migrations applied in setup via `readD1Migrations`/`applyD1Migrations`. Two seeded teams |
| Crypto | Round trip, AAD mismatch fails, old key still decrypts, raw rows contain no plaintext | Workers runtime WebCrypto |
| HTTP/Telegram | Missing/wrong/right secret; callback forged with a foreign team id | `SELF.fetch`. Bot API stubbed with a grammY transformer |
| Logging | PII fixtures never appear in logs | Spy on console across flows |

## Threat Matrix

Rows (docs-like paths, git selection, commit, push, PR commands): all N/A. This change has no shell, subprocess, VCS or executable-file boundary. The only HTTP routing boundary is the webhook, covered by the secret-token RED tests above.

## Migration / Rollout

Greenfield, additive `0001_init.sql`. Set secrets `BOT_TOKEN`, `WEBHOOK_SECRET`, `PII_KEYRING`, then `setWebhook` with `secret_token`. **Key backup**: generate the key ring offline, store it in a password manager with two custodians before running `wrangler secret put` (secrets cannot be read back). **Key loss**: encrypted fields and audit values become unrecoverable, and reads show "unreadable" instead of failing. Plaintext data (teams, roles, GitHub usernames) survives, and members re-enter the lost fields. **Rotation**: add a key and move `active`; old keys stay in the ring (no re-encryption job in this change).

## Open Questions

- [ ] Spec must confirm the 15-minute DM selection TTL. It is explicit and visible, not a silent default.
- [ ] Admin edit target syntax (membership reference in DM commands) is left to the spec.
