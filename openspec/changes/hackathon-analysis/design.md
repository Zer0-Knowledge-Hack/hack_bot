# Design: Hackathon Analysis with Slugs and Optional Topic Pinning

## Technical Approach

The change follows the existing hexagonal layout. Pure domain modules in `src/domain/hackathon/` classify the argument, normalize and guard URLs, generate slugs, validate the extraction, match repos and format replies.

A fresh analysis is split into two halves joined by one Cloudflare Queue (`hackathon-analysis`) on the same Worker:
- **Producer (webhook path, fast):** the pure `requestHackathonAnalysis` use case checks the admin gate, parses, normalizes and guards the URL string, and reserves the cap slot and the team lease. It then enqueues a minimal job message and acknowledges "Analyzing <host>…". The webhook returns 200 within the usual D1 and Telegram round trips.
- **Consumer (`queue()` handler):** the pure `runHackathonJob` use case claims the job in D1 and runs the pure `analyzeHackathon` (fetch → browser fallback → LLM → validate → persist → suggestions). It then posts the result through the publisher: a plain message in the general chat, or `linkAnalysisToTopic` (post plus pin) in a topic.

The show, link and list use cases stay synchronous. The adapters are a static fetcher (`fetch` plus `HTMLRewriter`), a Browser Rendering fetcher (`@cloudflare/puppeteer`), a Workers AI extractor, a public GitHub metadata source, D1 repos, a queue producer and a Telegram publisher. No Hono route and no cron job are added. Configuration is global Worker `vars`.

## Architecture Decisions

| Topic | Choice | Rejected (tradeoff) |
|---|---|---|
| Where the run executes | A Cloudflare Queue. The same Worker is the producer (`queues.producers`) and the consumer (`queue()` plus `queues.consumers`). Consumer wall clock is 15 min; the queue is on the Free plan | Sync inside `bot.handleUpdate` (a run of up to 40 s inside the webhook; Telegram's redelivery timing is undocumented). `ctx.waitUntil` (capped at 30 s after the response, too short for browser plus 2 LLM calls). Durable Objects or Workflows (more moving parts for one job type) |
| Message | `{ v: 1, jobId, teamId, chatId, threadId, fetchUrl }`: ids plus the guarded fetch URL. No user id, username, page content or model output. Far below 128 KB | Only `jobId` (a failure reply is impossible when D1 is down on the final attempt). Full context (PII risk) |
| Source of truth | The D1 `hackathon_analysis_jobs` row. The consumer uses the message fields only for a last-resort failure reply | Trusting the message (a duplicate could not be detected) |
| Batch | `max_batch_size: 1`, `max_concurrency: 1` | Batches of N (one slow browser run delays its siblings, and one thrown error retries the whole batch). Default concurrency, or 2 (bursts on the shared AI and browser quotas; Free-plan Browser Rendering allows only 1 new browser every 20 s, so two consumers launching at once would hit a rate 429) |
| Retries | Explicit `msg.ack()` / `msg.retry({ delaySeconds: 30 })`, `max_retries: 2`. Only transient errors are retried | Throwing from the handler (retries the whole batch without classification). High retry counts (they burn neurons and delay the reply) |
| Dead-letter queue | None in v1. Terminal failures are recorded in the job row (`status='failed'`, `failure_reason`) and replied to the user | A DLQ (a second queue, plus a consumer or manual drain nobody runs; the D1 row already records the outcome) |
| Cap and lease | The producer reserves one slot and sets the lease atomically (one `db.batch`). The consumer never touches `runs`, so a redelivery cannot double-count. No refund once the job has started | Counting in the consumer (a redelivery would double-count). Refunding failed runs (a failing URL could drain neurons) |
| Ports | `PageFetcher` (static and rendered instances), `LlmExtractor`, `HackathonAnalysisRepo`, `AnalysisQuota`, `AnalysisJobRepo`, `AnalysisJobQueue`, `RepoMetadataSource`, `ChatPublisher`, plus the existing `Clock`, `IdGen` and `MembershipRepo` | Calling grammY or `env.QUEUE` from a use case (breaks the domain import rule) |
| Fallback policy | The domain decides: a static fetch first; below 800 chars of reduced text, the rendered fetch | An adapter heuristic (not testable in the domain) |
| Validation | The pure `validateExtraction`, called by the adapter. At most 2 model calls (primary, then fallback) | Unbounded repair loops |
| Models | `vars.HACKATHON_MODEL_PRIMARY` = GLM-5.3-Flash (~155 neurons). `vars.HACKATHON_MODEL_FALLBACK` = DeepSeek V4 Flash (~440 neurons, a different vendor). Prompted "JSON only". IDs are validated with `^@(cf\|hf)/[A-Za-z0-9._/-]+$` | Kimi K2.6, QwQ-32B, Llama 3.3-70B (cost or quality). JSON Mode (forces other models). Hardcoded IDs |
| Config errors | Lazy parsing in the hackathon deps factory. A `ConfigError` becomes the "not configured" refusal | Parsing in `buildBot` (a bad var would break every command) |
| Suggestions | Deterministic token overlap. Top 3, stored | Extra LLM calls. Recomputing on every show |
| Storage | The validated extraction JSON, bounded; no page text | A column per field |

**Time budget (per consumer attempt):** a 180 s attempt deadline (`AbortSignal`). Per-step timeouts: static fetch 10 s, rendered fetch 45 s (`goto` 30 s), 45 s per LLM attempt (the fallback runs only if at least 50 s remain), GitHub metadata 3 s per call, and Telegram publish 10 s. I/O waits do not count as CPU, so the default 30 s CPU limit is kept.

**Lease:** 15 min, owned by `jobId`. The worst case is 3 attempts × 180 s plus 2 × 30 s of delay plus queue latency, about 11 min. The owner releases the lease at any terminal state, so in the normal case the team is unblocked right after the reply. Expiry only covers a lost message or a crashed consumer.

**Neuron and queue budget:** a typical run costs ~155 neurons; the worst case is ~595. At the cap, one team uses at most ~3,000 neurons per day. Each attempt costs about 3 queue operations, so the 10k operations per day allow roughly 3,000 jobs.

## Job State (D1) and Idempotency

```
queued ─claim─▶ running ─persist+mark (one batch)─▶ persisted ─post─▶ succeeded
   │               │ (claim_until expired → re-claim)          │
   └─stale >1 h─▶ failed ◀─permanent error / final attempt─────┘
```

- **Claim:** `UPDATE … SET status='running', claim_until=now+240s, attempts=attempts+1 WHERE id=? AND (status='queued' OR (status='running' AND claim_until<now))`.
  - When the job is already `succeeded` or `failed`, the consumer acks with no side effects: no post, no count and no LLM call.
  - While another invocation holds a live claim, the consumer calls `retry({ delaySeconds: 60 })`.
  - A `persisted` job skips fetch and LLM, re-reads `analysis_id` and only posts.
- **Persist:** the analysis insert or update and `status='persisted', analysis_id=?` run in one `db.batch`. The existing slug retry loop wraps the batch.
- **Post then mark:** the user-visible message goes out first and the terminal mark second. A crash between them yields at most one duplicate post (Telegram has no idempotency key), never silence.
- **Stale:** a `queued` job older than 1 h is failed as `expired` and refunded, because no neurons were spent. The user gets "Analysis expired; run it again."

## Data Flow

```
/hackathon <url>  (webhook, sync)
cmd ─ classify=url ─ assertSafeUrl ─ normalize ─ resolveGroupMembership ─ admin?
 └─ requestHackathonAnalysis
    ├─ quota.reserve(team, day, cap, now, 15 min, jobId)  [batch: usage upsert + job insert]
    │     busy | cap-reached → refusal (no enqueue)
    ├─ queue.send(msg) ─ fail → quota.release(refund) + job failed 'enqueue' → reply
    └─ reply "Analyzing <host>… the result will be posted here."   → 200

queue(batch)  (consumer, size 1)
index.queue ─ buildHackathonConsumer(env) ─ runHackathonJob(msg)
 ├─ jobs.claim ─ terminal → ack │ held → retry(60 s) │ persisted → post only
 ├─ analyzeHackathon: static ─(<800)─ rendered ─(429)→ degraded ≥200 chars | PageTooThin
 │    llm primary ─(invalid)─ fallback → validate → repoLinks+metadata → suggest → persist+mark
 ├─ general chat: publisher.post(chat, null, text)
 │  topic: linkAnalysisToTopic (post, pin, moveLink, unpin old; best-effort)
 ├─ jobs.markSucceeded ─ quota.release(owner=jobId, no refund) ─ ack
 ├─ permanent error → post failure reply ─ jobs.markFailed(reason) ─ release ─ ack
 └─ transient error → attempts ≤ 2 ? retry(30 s) : as permanent ("temporary error")
```

The rendered fetcher calls `page.setRequestInterception(true)`. Each request goes through the pure `browserRequestPolicy`: http(s) only, the same host guard, images, fonts, media and stylesheets aborted, and at most 100 requests. After `goto`, it re-checks `page.url()`, reads `innerText` (capped), and calls `browser.close()` in `finally`. A 429 raises `BrowserQuotaExceededError`.

The static fetcher uses `redirect: "manual"`. It follows at most 3 hops, re-guarding each one, and streams up to 2 MB. It accepts only a 200 `text/html` or `text/plain` response. `HTMLRewriter` drops noise elements and keeps the title, the meta and OG description and `ld+json` (up to 4 KB). The text is capped at 22,000 chars.

## Parsing, Normalization, Slugs

These are unchanged:
- **Classification:** a leading scheme or any `.` means a URL. `^[a-z0-9]+(-[a-z0-9]+)*$` with at most 48 chars means a slug. Anything else gets the usage reply.
- **URL guard:** applied on the URL string at the producer, and again at the consumer for every redirect and browser request. It allows only http(s), and rejects userinfo, ports other than 80 and 443, all IP literals, and single-label and private suffixes.
- **Normalization key:** the lowercase host without `www.`, no fragment or default port, tracking parameters dropped and the rest sorted, no trailing `/`, and scheme `https`. The consumer recomputes the key from `fetchUrl` with the same pure function.
- **Slug:** the name or the host, NFKD, `[a-z0-9-]`, and at most 40 chars. Collisions get `-2`…`-99`, then `-<6 hex>`. A refresh never changes the slug.

## Extraction Schema and Prompt

Unchanged: `Field<T> = { value; snippet ≤160, verbatim; confidence } | null`, covering name, format, location, team size, four dates, prizes, tracks and eligibility. Invalid fields become null, and so do fields whose snippet is not found in the page. The fallback model is tried when the output is unparseable or more than half of its fields are invalid. The page is framed as untrusted between `<<<PAGE`/`PAGE>>>` with those tokens stripped, and the call uses `temperature: 0` and `max_tokens: 1200`.

## Migration `0003_hackathon_analysis.sql`

`hackathon_analyses` and its partial thread index are unchanged. The usage table gains an owner column, and a jobs table is added:

```sql
CREATE TABLE hackathon_analysis_usage (
  team_id TEXT NOT NULL REFERENCES teams(id), utc_day TEXT NOT NULL CHECK (length(utc_day) = 10),
  runs INTEGER NOT NULL CHECK (runs >= 0), lease_until INTEGER NOT NULL DEFAULT 0,
  lease_job_id TEXT, PRIMARY KEY (team_id, utc_day));
CREATE TABLE hackathon_analysis_jobs (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id),
  chat_id INTEGER NOT NULL, thread_id INTEGER, utc_day TEXT NOT NULL,
  fetch_url TEXT NOT NULL CHECK (length(fetch_url) <= 2048),
  status TEXT NOT NULL CHECK (status IN ('queued','running','persisted','succeeded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, claim_until INTEGER NOT NULL DEFAULT 0,
  analysis_id TEXT REFERENCES hackathon_analyses(id),
  failure_reason TEXT CHECK (failure_reason IS NULL OR length(failure_reason) <= 64),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX hackathon_analysis_jobs_team ON hackathon_analysis_jobs (team_id, created_at);
```

**`reserve`:** one `db.batch` with two statements:
1. The usage upsert: `… ON CONFLICT DO UPDATE SET runs=runs+1, lease_until=?, lease_job_id=? WHERE runs<?cap AND lease_until<?now`.
2. `INSERT INTO hackathon_analysis_jobs … SELECT … WHERE EXISTS (SELECT 1 FROM hackathon_analysis_usage WHERE team_id=? AND utc_day=? AND lease_job_id=?)`.

When the job insert changes no row, the adapter reads the usage row to return `busy` or `cap-reached`.

**`release(team, day, jobId, refund)`:** clears the lease `WHERE lease_job_id=?`, and runs `runs=runs-1` only when `refund` is set.

## Interfaces / Contracts

```ts
interface AnalysisJobMessage { v: 1; jobId: string; teamId: TeamId; chatId: number; threadId: number | null; fetchUrl: string; }
interface AnalysisJobQueue { enqueue(m: AnalysisJobMessage): Promise<void>; } // throws QueueSendFailedError
interface AnalysisQuota { reserve(i: { team: TeamId; day: string; cap: number; now: number; leaseMs: number; job: NewJob }): Promise<"ok" | "busy" | "cap-reached">; release(team: TeamId, day: string, jobId: string, refund: boolean): Promise<void>; }
interface AnalysisJobRepo { claim(id: string, now: number): Promise<ClaimResult>; markPersisted; markSucceeded; markFailed(id: string, reason: JobFailureReason): Promise<void>; }
type ClaimResult = { kind: "claimed"; job: Job } | { kind: "persisted"; job: Job } | { kind: "terminal" } | { kind: "held" } | { kind: "missing" };
interface ChatPublisher { post(chatId: number, threadId: number | null, text: string): Promise<number>; pin; unpin; } // post throws PublishFailedError(AlertSendFailureClass)
type JobOutcome = { kind: "ack" } | { kind: "retry"; delaySeconds: number };
```

`PageFetcher`, `LlmExtractor`, `RepoMetadataSource` and `HackathonAnalysisRepo` are unchanged. `runHackathonJob(msg, attempt, deps): Promise<JobOutcome>` is pure. `src/index.ts` maps its result to `msg.ack()` or `msg.retry()` and never throws.

## Error Taxonomy

Producer rows are synchronous refusals (2xx). Consumer rows are posted as messages to the originating chat or topic.

| Error | Where | User reply | Log reason | Cap | Queue action |
|---|---|---|---|---|---|
| `UnauthorizedError` | producer | Only a team admin may analyze or link a hackathon. | UnauthorizedError | No | — |
| bad argument | producer | Usage: /hackathon <url or slug> | BadArgument | No | — |
| `UnsafeUrlError` | producer / consumer (redirect) | Only public http(s) pages can be analyzed. | `unsafe-url:{…,redirect}` | No / Yes | ack |
| `DailyCapReachedError` | producer | Daily limit reached (5 new analyses per UTC day). Re-showing a slug is free. | — | No | — |
| `AnalysisBusyError` | producer | An analysis is already running for this team. Wait for its result. | — | No | — |
| `QueueSendFailedError` | producer | Could not start the analysis; try again in a minute. This did not count toward the daily limit. | `queue:send-failed` | Refunded | — |
| `ConfigError` | both | Hackathon analysis is not configured. | fixed message | No (refund) | ack |
| `AnalysisNotFoundError` | sync show | No analysis with that slug. See /hackathons. | — | No | — |
| `PageFetchFailedError` | consumer | Could not read that page (<kind>). Any previous analysis was kept. | `fetch:{timeout,too-large,http-status,content-type,redirects,network}` | Yes | ack |
| `PageTooThinError` | consumer | The page has too little readable text. Previous analysis kept. | `fetch:too-thin[-browser-quota]` | Yes | ack |
| `LlmQuotaExceededError` | consumer | Today's shared AI quota is used up; try after 00:00 UTC. Previous analysis kept. | `llm:quota` | Yes | ack |
| `ExtractionFailedError` | consumer | The AI could not produce a valid analysis. Previous analysis kept. | `llm:{invalid-output,model-error,timeout}` | Yes | ack |
| transient (D1, `PublishFailedError` unavailable or rate-limited, unknown) | consumer | on the final attempt: The analysis failed due to a temporary error. Try again later. | `job:transient:<name>` | Yes | retry 30 s, ack after attempt 3 |
| `PublishFailedError` rejected | consumer | (none possible) | `publish:rejected` | Yes | ack |
| job expired (queued > 1 h) | consumer | Analysis expired; run it again. | `job:expired` | Refunded | ack |
| `PinFailedError` / browser 429 degrade | consumer | rights note / "rendered page unavailable" footer | `pin:*`, `browser:quota-degraded` | — | ack |

## Pin Behavior

Unchanged: the link persists even when the pin fails, and unpins are best-effort. The only difference is that a `/hackathon <url>` run inside a topic now links and pins from the consumer.

## File Changes

| Path | Action | Description |
|---|---|---|
| `migrations/0003_hackathon_analysis.sql` | Create | Analyses, usage (with lease owner), jobs |
| `src/domain/hackathon/{argument,url,slug,extraction,suggest,format}.ts` | Create | Pure logic |
| `src/domain/text-limit.ts` | Create | `joinLinesWithinLimit` |
| `src/domain/{entities,ports,errors}.ts` | Modify | Entities, ports, errors (including queue and job errors) |
| `src/domain/usecases/{request-hackathon-analysis,run-hackathon-job,analyze-hackathon,show-analysis,link-analysis-to-topic,list-analyses}.ts` | Create | Use cases |
| `src/adapters/http/{safe-fetcher,html-to-text}.ts` | Create | Static fetch |
| `src/adapters/browser/rendered-fetcher.ts` | Create | Puppeteer with an injected `launch` |
| `src/adapters/llm/{workers-ai-extractor,prompt}.ts` | Create | Injected `run` |
| `src/adapters/github/repo-metadata.ts` | Create | Public REST call |
| `src/adapters/d1/{hackathon-analysis-repo,analysis-quota,analysis-job-repo}.ts` | Create | SQL |
| `src/adapters/queue/analysis-job-queue.ts` | Create | `Queue.send`; maps errors to `QueueSendFailedError` |
| `src/adapters/telegram/chat-publisher.ts` | Create | `sendMessage` (optional thread), pin and unpin |
| `src/adapters/telegram/{commands,command-outcome}.ts` | Modify | Commands, `reason` passthrough, `reposReply` refactor |
| `src/index.ts` | Modify | `export default { fetch: app.fetch, queue }`, where `queue` validates the message shape and maps `JobOutcome` to ack or retry |
| `src/composition.ts` | Modify | `buildHackathonConsumer(env)`, which uses `new Api(BOT_TOKEN)` without `PII_KEYRING`, like `buildGithubRouter` |
| `src/env.ts`, `wrangler.jsonc`, `package.json` | Modify | `AI`, `BROWSER` and `HACKATHON_QUEUE` bindings, the consumer config, 3 vars, `@cloudflare/puppeteer` |
| `test/fakes/index.ts`, `test/fixtures/hackathon/*.html` | Modify / Create | Fakes (including the queue and job repo) and fixtures |

## Testing Strategy (Strict TDD; no live queue, AI, browser or GitHub calls)

| Layer | What | Approach |
|---|---|---|
| Domain | Classifier, guard, normalization, slugs, validator, suggestions, and truncation. `requestHackathonAnalysis`: admin gate, busy or cap before enqueue, enqueue failure refunds, ack text. `runHackathonJob`: a terminal job means no side effects; a held claim means retry; a persisted job only posts; permanent errors mean reply, fail and ack; transient errors mean retry, then a failure reply on attempt 3; stale jobs are refunded; the LLM is never called twice for a completed job | Vitest with in-memory fakes |
| D1 | Uniqueness constraints, `moveLink`, the atomic `reserve` batch (cap, lease, owner), owner-checked `release`, claim transitions and re-claim after `claim_until`, and the persist-plus-mark batch | vitest-pool-workers |
| Consumer handler | `worker.queue(fakeBatch)` with a fake `Message` (`ack` and `retry` spies) and fake ports: a malformed body is acked and logged, a duplicate delivery is a no-op, retry uses `delaySeconds`, and the handler never throws | Direct handler call; no live queue |
| Adapters | Fetcher (redirect to a private host, 2 MB overflow, timeout, content type), browser policy, LLM (primary then fallback, quota), publisher error classes, and a queue send failure | Injected `fetch`, `launch`, `run` and `send` |
| Commands | Ack and refusal replies per producer row; no URL or page text in logs | `telegram-stub.ts` |

## Threat Matrix

N/A: no shell, subprocess, VCS/PR automation or new HTTP route. The queue handler is an internal trigger. Its body is shape-validated, and messages from an unknown version are acked and logged. The outbound SSRF boundary is a set of design requirements, each with a RED test: scheme, userinfo, port, IP literals, private suffixes, a redirect hop, a browser sub-request, the final `page.url()`, and the re-guard of `fetchUrl` in the consumer. **Residual risk:** DNS rebinding cannot be closed on Workers.

## Migration / Rollout

PR slicing (a feature-branch chain, each PR under 400 lines):
1. Domain pure modules and `text-limit` (~350)
2. Ports, errors, `analyzeHackathon` and fakes (~350)
3. `requestHackathonAnalysis` and `runHackathonJob` with their unit tests (~380)
4. Show, link and list use cases (~300)
5. The migration and the D1 repos (analysis, quota, job) (~390)
6. The static fetcher and `html-to-text` (~300)
7. The rendered fetcher (~250)
8. The Workers AI extractor and GitHub metadata (~350)
9. The queue adapter, `index.queue`, the consumer composition and the handler tests (~300)
10. The publisher, commands, env and wrangler (~350)

Operator steps:
1. Confirm that Workers AI and Browser Rendering are available, and run `npx wrangler queues create hackathon-analysis`.
2. Put the model IDs in `vars`.
3. Enable the bindings in `wrangler.jsonc`:
   - `ai`
   - `browser`
   - `queues.producers [{ queue: "hackathon-analysis", binding: "HACKATHON_QUEUE" }]`
   - `queues.consumers [{ queue: "hackathon-analysis", max_batch_size: 1, max_retries: 2, retry_delay: 30, max_concurrency: 1 }]`
4. Apply the D1 migration remotely, then deploy.
5. Give the bot the "Pin messages" right.
6. Smoke-test in the general chat, then in a topic.

Rollback: redeploy the previous version and remove the bindings and the consumer. Any queued messages then expire after the 24 h retention. The tables are additive.

## Open Questions

- [ ] The exact `@cf/...` catalog IDs and the context windows (at least 10k tokens) for GLM-5.3-Flash and DeepSeek V4 Flash. Verify them at apply time.
- [x] Resolved: `max_concurrency: 1`. Cloudflare docs (checked 2026-09-26), Free plan: 3 concurrent browsers, but 1 new browser every 20 s. Team usage is low (5 runs per team per day), so serial processing costs little and avoids launch-rate 429s. Any browser 429 (daily quota or the rare launch-rate case) follows the same degrade path, with no browser retry, so the spec stays unchanged.
