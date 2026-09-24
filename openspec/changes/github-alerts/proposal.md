# Proposal: GitHub Alerts Routed to Linked Forum Topics

## Intent

Right now PR and issue activity goes unseen unless someone checks GitHub. The team runs one Telegram forum topic per project, so each repo's alerts should land in that project's topic. This is roadmap change 2, and it should reach production fast.

## Scope

### In Scope
- `POST /github/webhook` verified with HMAC-SHA256 over the raw body, using one global Worker secret `GITHUB_WEBHOOK_SECRET`
- **Org claim**: each GitHub org is bound to exactly one team through a D1 row, created once by the operator. Links and deliveries are accepted only for repos of an org the team has claimed.
- `/linkrepo <owner/repo>` and `/unlinkrepo <owner/repo>`, run inside a topic by team admins only. `/repos` lists the current links.
- A repo belongs to at most one topic per team. A topic can hold many repos. Re-linking moves the repo to the new topic and says so in the reply.
- **Unlinked repos are ignored.** The event is acknowledged and dropped. There is no fallback to the data channel.
- Default events (the user can adjust these): `pull_request` opened, closed/merged and review_requested; `issues` opened and closed
- A short alert message, truncated to Telegram's limit, built from repo, action, actor login, number, title and URL only. Payloads are never stored or logged.

### Out of Scope (deferred)
- Digest and cron, event storage and retention
- Per-team secrets, GitHub App, self-serve org claim
- CI, release, push and discussion events; per-repo event toggles; coalescing and rate-limit batching; `X-GitHub-Delivery` dedupe
- Audit rows for link changes
- Natural-language linking (roadmap change 4 will reuse these use cases)

**Why unlinked repos are ignored**: the data channel is where member PII is shown. Sending every repo's traffic there as a fallback would bury that data and push noise into a topic with a different purpose. Explicit opt-in per repo matches the team's "one topic per thing" model and keeps alerts predictable.

## Capabilities

### New Capabilities
- `github-webhook`: signature verification, ping handling, event and action filtering, org-claim check
- `repo-topic-links`: org claim, link, unlink and list, admin-only permission, one topic per repo
- `github-alerts`: routing events to the linked topic, message format, PII-minimal fields, delivery-failure handling

### Modified Capabilities
- None

## Approach

Use the existing hexagonal design. The domain gets use cases with no Telegram parsing: `linkRepoToTopic(teamId, actor, repo, threadId)`, `unlinkRepo`, `listRepoLinks` and `routeGithubEvent(event)`. That keeps them callable from a future LLM layer. A new additive migration adds `github_org_claims` and `repo_topic_links`, both keyed by `team_id`. The HTTP adapter verifies the signature before it parses the body. Delivery goes through `bot.api.sendMessage` with `message_thread_id`. After a valid signature the route returns 2xx, except for unexpected infrastructure failures (e.g. D1), which return 500 so the delivery shows as failed in GitHub and can be redelivered. Send failures are logged by reason only.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `migrations/0002_*.sql` | New | Claims and links tables |
| `src/domain/` | Modified | Entities, ports, use cases |
| `src/adapters/d1/`, `src/adapters/github/` | New | Repos, HMAC verifier, payload mapper |
| `src/adapters/telegram/commands.ts` | Modified | Three commands |
| `src/index.ts`, `src/composition.ts`, `src/env.ts` | Modified | Route, wiring, secret |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Another group links private repos | High without claim | Org-claim check at link time and at delivery |
| Spoofed webhook | Med | HMAC over raw bytes, constant-time compare |
| Chat spam or rate limits | Low | Narrow default events |
| Topic deleted, sends fail | Med | Log, return 2xx, admin re-links |

## Rollback Plan

Remove the org webhook in GitHub settings, or redeploy the previous Worker. The migration only adds tables. Drop them only after exporting the data.

## Dependencies

- Org-level webhook configured by the operator, the Worker secret, and a one-time claim row (config/data, not code)

## Success Criteria

- [ ] Unsigned or wrongly signed requests are rejected before parsing
- [ ] A PR opened on a linked repo appears in its topic
- [ ] Unlinked or unclaimed-org events send nothing
- [ ] Non-admins cannot link or unlink
- [ ] Domain use cases have no grammY or Hono imports

## Proposal question round

Assumptions to review: one team, one org, admin-only linking, and the org claim is an operator step.

## Open questions for the user

1. **Should unlinked repos stay silent?** Recommended: yes. Opt in per repo.
2. **Is a one-time operator SQL step acceptable for claiming the org?** Recommended: yes for now, and a `/claimorg` command with ownership proof later.
3. **Should review_requested alerts mention the reviewer's Telegram handle, using `github_username`?** Recommended: not in this slice. Plain logins only.
