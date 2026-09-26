# Design: GitHub Alerts Routed to Linked Forum Topics

## Technical Approach

This change reuses the existing hexagonal layout. A new Hono route, `POST /github/webhook`, reads the raw body and verifies `X-Hub-Signature-256` with WebCrypto before anything is parsed. An adapter mapper (`adapters/github`) then turns the JSON into a small domain `GithubEvent`, or `null` when the event is unsupported. A pure use case, `routeGithubEvent`, resolves org to claim to team to link, formats a plain-text alert and sends it through an `AlertSender` port. That port is backed by grammY's `Api.sendMessage` with `message_thread_id`. Linking uses three admin commands that call pure use cases (`linkRepoToTopic`, `unlinkRepo`, `listRepoLinks`), so a future LLM layer can call the same code. There is no cron, no event storage and no change to the logger allowlist.

## Architecture Decisions

| Topic | Choice | Rejected (tradeoff) |
|---|---|---|
| Signature check | Validate the header against `^sha256=[0-9a-f]{64}$`, then `crypto.subtle.sign("HMAC")` over the `arrayBuffer()` body, then `timingSafeEqual`, all before `JSON.parse`. An empty or missing secret is treated as a config error, never as a verify against an empty key | `subtle.verify` (constant-time is not asserted by an existing runtime test); parse-then-verify (spoofing risk) |
| Secret scope | One global `GITHUB_WEBHOOK_SECRET` | Per-team secrets (no UX to reveal them once). Future path: an additive encrypted secret column on `github_org_claims` plus a `/github/webhook/:claimId` route, because the secret must be known before the body is parsed |
| Tenancy for routing | `GithubOrgClaimRepo.findTeamByOrg` is the only cross-team lookup (documented, like `MembershipRepo.findByUser`). Everything after it takes `TeamId` first | Scan links across teams (leak-prone) |
| Claim enforcement | Checked in the use case and enforced again in D1 with a composite FK `(team_id, org_login)` pointing at the claim | Use-case check only |
| Event filtering | Done in the adapter mapper. The domain never sees raw payload shapes | Domain parses JSON (couples the domain to GitHub) |
| Message | Plain text with no `parse_mode`. Title capped at 256 chars and the whole message at 4096 | MarkdownV2 (escaping bugs cause failed sends) |
| Sender | `new Api(BOT_TOKEN)` in composition. No `Bot` and no `PII_KEYRING` on this route | `buildBot()` (a broken keyring would also break alerts) |
| Logging | Existing `LogEvent`. `reason` holds only fixed strings (`ignored:unlinked-repo`, and so on) | New allowlisted fields (repo names are not needed to operate) |

### GitHub route status policy (mirrors the Telegram RES-001/002 rule: permanent means 2xx, transient infra means 500)

| Case | Status |
|---|---|
| Signature header missing, malformed or wrong | 401, body never parsed |
| `GITHUB_WEBHOOK_SECRET` unset or empty | 500, logged as a `ConfigError` reason |
| `ping` | 200 |
| Invalid JSON, a non-object, or an unsupported event or action | 200, logged |
| Org not claimed, or repo not linked | 200, `outcome: "ok"` with an `ignored:*` reason |
| Telegram send fails (for example, the topic was deleted) | 200, `errorCode: "AlertSendFailed"` |
| Unexpected error (for example, D1) | 500. GitHub does not auto-retry, so the delivery stays visible for a manual redeliver |

## Data Flow

```
GitHub ─POST /github/webhook─> Hono: raw bytes ─> HMAC check ─401?─┐
  └─> JSON.parse ─> mapGithubEvent (null => 200 ignored)            │
      └─> routeGithubEvent(event, deps)                              │
          claimRepo.findTeamByOrg ─> linkRepo.get(teamId, repo)
          ─> teamRepo.get(teamId).chatId ─> formatGithubAlert
          ─> AlertSender.send(chatId, threadId, text) ─> 200
Telegram /linkrepo (in topic) ─> resolveGroupMembership ─> linkRepoToTopic
```

## File Changes

| Path | Action | Description |
|---|---|---|
| `migrations/0002_github_alerts.sql` | Create | Claims and links tables |
| `src/domain/github.ts` | Create | `RepoFullName`, `parseRepoFullName`, `GithubEvent`, `formatGithubAlert` |
| `src/domain/{entities,ports,errors}.ts` | Modify | `RepoTopicLink`; three ports; `InvalidRepoError`, `OrgNotClaimedError`, `AlertSendFailedError` |
| `src/domain/usecases/{link-repo,unlink-repo,list-repo-links,route-github-event}.ts` | Create | Pure use cases |
| `src/adapters/d1/{github-org-claim-repo,repo-topic-link-repo}.ts` | Create | Tenant-scoped SQL |
| `src/adapters/github/{signature,event-mapper}.ts` | Create | HMAC verify and allowlisted field extraction |
| `src/adapters/telegram/alert-sender.ts` | Create | `api.sendMessage` wrapper |
| `src/adapters/telegram/commands.ts` | Modify | `/linkrepo`, `/unlinkrepo`, `/repos` |
| `src/index.ts`, `src/composition.ts`, `src/env.ts` | Modify | Route, `buildGithubRouter(env)`, secret |
| `vitest.config.ts`, `.dev.vars.example` | Modify | Test and example `GITHUB_WEBHOOK_SECRET` |

```sql
-- 0002_github_alerts.sql (lowercase logins, epoch-ms)
CREATE TABLE github_org_claims (
  org_login TEXT PRIMARY KEY CHECK (org_login = lower(org_login)), -- one org -> one team
  team_id TEXT NOT NULL REFERENCES teams(id),
  created_at INTEGER NOT NULL,
  UNIQUE (team_id, org_login)
);
CREATE TABLE repo_topic_links (
  team_id TEXT NOT NULL,
  repo_full_name TEXT NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  org_login TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, repo_full_name),               -- one topic per repo per team
  FOREIGN KEY (team_id, org_login) REFERENCES github_org_claims(team_id, org_login)
);
```

## Interfaces / Contracts

```ts
type GithubEvent = { org: string; repo: RepoFullName; kind: "pull_request" | "issues";
  action: "opened" | "closed" | "merged" | "review_requested";
  number: number; title: string; url: string; actor: string; reviewer?: string }; // logins only
interface GithubOrgClaimRepo {
  findTeamByOrg(orgLogin: string): Promise<TeamId | null>; // sole cross-team lookup
  isClaimedBy(teamId: TeamId, orgLogin: string): Promise<boolean>;
}
interface RepoTopicLinkRepo {
  get(teamId: TeamId, repo: RepoFullName): Promise<RepoTopicLink | null>;
  upsert(teamId: TeamId, link: RepoTopicLink): Promise<void>; // ON CONFLICT DO UPDATE thread_id
  remove(teamId: TeamId, repo: RepoFullName): Promise<boolean>;
  list(teamId: TeamId): Promise<RepoTopicLink[]>;
}
interface AlertSender { send(chatId: number, threadId: number, text: string): Promise<void>; } // throws AlertSendFailedError
linkRepoToTopic({ teamId, actorMembershipId, repo, threadId }, deps): Promise<{ repo; previousThreadId: number | null }>
routeGithubEvent(event, deps): Promise<{ kind: "delivered" | "send-failed"; teamId } | { kind: "ignored"; reason: "unclaimed-org" | "unlinked-repo" }>
// alert-sender.ts
await api.sendMessage(chatId, text, { message_thread_id: threadId, link_preview_options: { is_disabled: true } });
```

`merged` means `closed` with `pull_request.merged === true`. `reviewer` is `requested_reviewer.login`, or `requested_team.slug` when a team was requested. Link and unlink need an admin, the thread must not be null (the same refusal as `/datachannel`), and the repo owner must be claimed by the team.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Domain (first) | Parsing, admin gate, claim gate, move reply, routing outcomes, truncation | Vitest with fakes in `test/fakes` |
| D1 | Upsert and move, FK rejection of an unclaimed org, two-team isolation | vitest-pool-workers |
| Adapters | HMAC (valid, wrong, same-length wrong, malformed header, empty secret); mapper allowlist (a commit email in the fixture never appears in the output) | Workers runtime |
| HTTP | The status policy table above; `sendMessage` carries `message_thread_id`; console output holds no payload fixture strings | `SELF.fetch` with `vi.stubGlobal(fetch)`, as in `webhook-e2e.test.ts` |

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths, git selection, commit, push, PR commands | N/A: no shell, subprocess, VCS or executable-file boundary |
| HTTP routing (new ingress) | Applicable. The RED tests are the signature and status rows above; they must propagate to tasks |

## Migration / Rollout

The migration is additive. Operator steps:

1. `openssl rand -hex 32`, save it in the password manager, then `npx wrangler secret put GITHUB_WEBHOOK_SECRET`.
2. `npx wrangler d1 migrations apply hack-bot-db --remote`, then deploy.
3. In the GitHub org, open Settings → Webhooks → Add. Payload URL: `https://hack-bot.<subdomain>.workers.dev/github/webhook`. Content type: **application/json**. Secret: the same value. Events: Pull requests and Issues. The ping should return 200.
4. Claim the org. First find the team id with `npx wrangler d1 execute hack-bot-db --remote --command "SELECT id, telegram_chat_id FROM teams"`. Then run `npx wrangler d1 execute hack-bot-db --remote --command "INSERT INTO github_org_claims (org_login, team_id, created_at) VALUES (lower('<org>'), '<team-id>', unixepoch()*1000)"`.
5. Run `/linkrepo <org>/<repo>` inside the target topic.

Rollback: delete the org webhook, or redeploy the previous version. The tables can stay.

**PR slicing** (feature-branch chain, each PR under 400 lines):

1. The migration and domain (`github.ts`, ports, errors, four use cases), plus fakes and tests (~350).
2. The D1 repos and their tests (~250).
3. `signature.ts`, the route skeleton (401, 500, ping and malformed JSON), the env and the test binding (~250).
4. The mapper, alert sender, `buildGithubRouter` wiring and the end-to-end delivery tests (~300).
5. The `/linkrepo`, `/unlinkrepo` and `/repos` commands and their tests (~250). This PR must merge before the operator runs step 5.

## Open Questions

- [x] Can any team member run `/repos`, or only admins? Resolved: any registered team member, anywhere in the group; only admins can link or unlink.
