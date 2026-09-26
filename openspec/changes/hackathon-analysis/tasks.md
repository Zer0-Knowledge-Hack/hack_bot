# Tasks: Hackathon Analysis with Slugs and Optional Topic Pinning

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3300 (domain, ports, D1, fetchers, LLM, queue, publisher, commands, tests) |
| 400-line budget risk | High (aggregate); each PR individually Low-Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR1 domain → PR2 ports/errors/analyzeHackathon → PR3 request/run job → PR4 show/link/list → PR5 migration+D1 → PR6 static fetch → PR7 browser fetch → PR8 LLM+GitHub metadata → PR9 queue+consumer → PR10 publisher/commands/env/wrangler → PR11 operator rollout (not apply) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pure domain: argument, url, slug, extraction validator, suggest, format, text-limit | PR1 (~350) | `npm test -- test/domain/hackathon` | N/A — pure Vitest | delete `src/domain/hackathon/*.ts`, `src/domain/text-limit.ts` |
| 2 | Entities/ports/errors + `analyzeHackathon` use case + fakes | PR2 (~350) | `npm test -- test/domain/usecases/analyze-hackathon.test.ts` | N/A — pure Vitest with fakes | delete new port/error additions, `analyze-hackathon.ts` |
| 3 | `requestHackathonAnalysis` + `runHackathonJob` unit tests | PR3 (~380) | `npm test -- test/domain/usecases/{request-hackathon-analysis,run-hackathon-job}.test.ts` | N/A — pure Vitest with fakes | delete both use case files and tests |
| 4 | `showAnalysis`, `linkAnalysisToTopic`, `listAnalyses` | PR4 (~300) | `npm test -- test/domain/usecases/{show-analysis,link-analysis-to-topic,list-analyses}.test.ts` | N/A — pure Vitest | delete the three use case files |
| 5 | Migration `0003_hackathon_analysis.sql` + D1 repos (analysis, quota, job) | PR5 (~390) | `npm test -- test/adapters/d1/hackathon` | vitest-pool-workers D1 | delete migration, `src/adapters/d1/{hackathon-analysis-repo,analysis-quota,analysis-job-repo}.ts` |
| 6 | Static fetcher + `html-to-text` | PR6 (~300) | `npm test -- test/adapters/http/safe-fetcher.test.ts` | injected `fetch` fake | delete `src/adapters/http/{safe-fetcher,html-to-text}.ts` |
| 7 | Rendered (browser) fetcher | PR7 (~250) | `npm test -- test/adapters/browser/rendered-fetcher.test.ts` | injected `launch` fake | delete `src/adapters/browser/rendered-fetcher.ts` |
| 8 | Workers AI extractor + GitHub metadata source | PR8 (~350) | `npm test -- test/adapters/llm test/adapters/github` | injected `run`/`fetch` fakes | delete `src/adapters/llm/*.ts`, `src/adapters/github/repo-metadata.ts` |
| 9 | Queue adapter, `index.queue`, consumer composition, handler tests | PR9 (~300) | `npm test -- test/index.queue.test.ts` | direct `worker.queue(fakeBatch)` call, fake `Message` | revert `queue` export in `src/index.ts`, delete `src/adapters/queue/analysis-job-queue.ts` |
| 10 | Publisher, commands, env, wrangler | PR10 (~350) | `npm test -- test/adapters/telegram/commands.test.ts` | `telegram-stub.ts` + `SELF.fetch` | revert `commands.ts` registration, `src/adapters/telegram/chat-publisher.ts`, env/wrangler additions |
| 11 | Operator rollout (not performed by apply) | PR11/manual | N/A | live smoke test in general chat + topic | N/A — operational steps, no code rollback |

## Phase 1: Domain Foundation — Pure Modules (PR1)

- [ ] 1.1 RED: `test/domain/hackathon/argument.test.ts` — slug vs URL classification (spec hackathon-analysis: Argument Classified as Slug or URL, both scenarios).
- [ ] 1.2 GREEN: `src/domain/hackathon/argument.ts` classifier.
- [ ] 1.3 RED: `test/domain/hackathon/url.test.ts` — scheme/userinfo/port/IP-literal/private-suffix guard, normalization key (spec page-fetch: Scheme and Destination Guard, both scenarios).
- [ ] 1.4 GREEN: `src/domain/hackathon/url.ts` guard + normalize.
- [ ] 1.5 RED: `test/domain/hackathon/slug.test.ts` — name/host derivation, NFKD, 40-char cap, collision suffixes (spec hackathon-analysis: Slug Generation and Uniqueness, both scenarios).
- [ ] 1.6 GREEN: `src/domain/hackathon/slug.ts`.
- [ ] 1.7 RED: `test/domain/hackathon/extraction.test.ts` — `validateExtraction`: schema pass/reject, null-over-guess, snippet ≤160 verbatim (spec llm-extraction: Strict Schema Output, Null Over Guess, Bounded Source Snippet).
- [ ] 1.8 GREEN: `src/domain/hackathon/extraction.ts`.
- [ ] 1.9 RED/GREEN: `src/domain/hackathon/suggest.ts` — deterministic token-overlap top-3 repo suggestion, with test.
- [ ] 1.10 RED/GREEN: `src/domain/hackathon/format.ts` — analysis and `/hackathons` list formatting, with test.
- [ ] 1.11 RED/GREEN: `src/domain/text-limit.ts` — `joinLinesWithinLimit` (spec hackathon-analysis: Listing Is Read-Only and Truncated, Plain Text Replies), with test.

## Phase 2: Ports, Errors, analyzeHackathon (PR2)

- [ ] 2.1 Add ports to `src/domain/ports.ts`: `PageFetcher`, `LlmExtractor`, `HackathonAnalysisRepo`, `AnalysisQuota`, `AnalysisJobRepo`, `AnalysisJobQueue`, `RepoMetadataSource`, `ChatPublisher`.
- [ ] 2.2 Add entities to `src/domain/entities.ts`: analysis record, `AnalysisJobMessage`, `ClaimResult`, `JobOutcome`.
- [ ] 2.3 Add errors to `src/domain/errors.ts`: `UnsafeUrlError`, `PageFetchFailedError`, `PageTooThinError`, `ExtractionFailedError`, `LlmQuotaExceededError`, `QueueSendFailedError`, `AnalysisBusyError`, `DailyCapReachedError`, `ConfigError`, `AnalysisNotFoundError`, `PublishFailedError`, `BrowserQuotaExceededError`.
- [ ] 2.4 Add fakes to `test/fakes/index.ts` for every new port (in-memory, injectable failure modes).
- [ ] 2.5 RED: `test/domain/usecases/analyze-hackathon.test.ts` — static-then-browser fallback below 800 chars (spec page-fetch: Browser Rendering Fallback on Thin Static Text), 429-degrade path (spec page-fetch: Browser Rendering Quota Exhaustion, both scenarios), primary-then-fallback LLM call, persist+suggestions.
- [ ] 2.6 GREEN: `src/domain/usecases/analyze-hackathon.ts`.

## Phase 3: requestHackathonAnalysis + runHackathonJob (PR3)

- [ ] 3.1 RED: `test/domain/usecases/request-hackathon-analysis.test.ts` — admin gate (spec hackathon-analysis: Admin-Only Fresh Analysis, Capped, both scenarios), busy refusal (spec: Analysis already running), cap-reached refusal (spec: Cap reached), enqueue failure refunds (spec: Enqueue failure).
- [ ] 3.2 GREEN: `src/domain/usecases/request-hackathon-analysis.ts`.
- [ ] 3.3 RED: `test/domain/usecases/run-hackathon-job.test.ts` — terminal job is a no-op ack (spec: Duplicate delivery), held claim retries, persisted job only posts, transient error retries then fails on attempt 3 (spec: Transient failure exhausts retries), stale job refunded.
- [ ] 3.4 GREEN: `src/domain/usecases/run-hackathon-job.ts`.

## Phase 4: Show, Link, List Use Cases (PR4)

- [ ] 4.1 RED: `test/domain/usecases/show-analysis.test.ts` — re-show by slug free of cap (spec: Member re-shows an existing slug), not-found error (spec: `AnalysisNotFoundError`).
- [ ] 4.2 GREEN: `src/domain/usecases/show-analysis.ts`.
- [ ] 4.3 RED: `test/domain/usecases/link-analysis-to-topic.test.ts` — link into empty topic, move-link + unpin old on conflict, both directions (spec hackathon-analysis: One Analysis Per Topic, Conflicts Move the Link, all three scenarios), pin-failure fallback (spec: Pin Failure Falls Back to Unpinned Posting).
- [ ] 4.4 GREEN: `src/domain/usecases/link-analysis-to-topic.ts`.
- [ ] 4.5 RED/GREEN: `test/domain/usecases/list-analyses.test.ts` + `src/domain/usecases/list-analyses.ts` — slug/name/deadline/linked status, truncation at 4096 (spec: Listing Is Read-Only and Truncated, both scenarios).

## Phase 5: Migration + D1 Repos (PR5)

- [ ] 5.1 Create `migrations/0003_hackathon_analysis.sql` — `hackathon_analyses`, `hackathon_analysis_usage` (with lease owner), `hackathon_analysis_jobs`, partial thread index, team index.
- [ ] 5.2 RED: `test/adapters/d1/hackathon-analysis-repo.test.ts` — unique slug, unique URL, unique `thread_id` (nullable), `moveLink`.
- [ ] 5.3 GREEN: `src/adapters/d1/hackathon-analysis-repo.ts`.
- [ ] 5.4 RED: `test/adapters/d1/analysis-quota.test.ts` — atomic `reserve` batch (cap, lease, owner), `busy` vs `cap-reached` classification, owner-checked `release` with/without refund (spec: Daily Cap on Fresh Runs, Fresh Analysis Job Safety Under Concurrency).
- [ ] 5.5 GREEN: `src/adapters/d1/analysis-quota.ts`.
- [ ] 5.6 RED: `test/adapters/d1/analysis-job-repo.test.ts` — claim transitions (queued→running, re-claim after `claim_until` expiry, terminal→ack, persisted→post-only), persist+mark in one batch.
- [ ] 5.7 GREEN: `src/adapters/d1/analysis-job-repo.ts`.

## Phase 6: Static Fetcher (PR6)

- [ ] 6.1 RED: `test/adapters/http/safe-fetcher.test.ts` — redirect to private host refused (spec page-fetch: Loopback or private host), 2 MB overflow abort (spec: Response exceeds the size cap), 10 s timeout (spec: Fetch exceeds the time cap), non-200/non-html rejected, `redirect: "manual"` with 3-hop cap.
- [ ] 6.2 GREEN: `src/adapters/http/safe-fetcher.ts`.
- [ ] 6.3 RED/GREEN: `src/adapters/http/html-to-text.ts` — `HTMLRewriter` noise-strip, title/meta/OG/`ld+json` retained, 22,000-char cap, with test.

## Phase 7: Rendered (Browser) Fetcher (PR7)

- [ ] 7.1 RED: `test/adapters/browser/rendered-fetcher.test.ts` — request-interception policy (http(s) only, host re-guard, images/fonts/media/stylesheets aborted, 100-request cap), `page.url()` re-check after `goto` (spec page-fetch: Browser rendering redirect to an unsafe target), `browser.close()` in `finally`, 429 → `BrowserQuotaExceededError`.
- [ ] 7.2 GREEN: `src/adapters/browser/rendered-fetcher.ts` with injected `launch`.

## Phase 8: Workers AI Extractor + GitHub Metadata (PR8)

- [ ] 8.1 RED: `test/adapters/llm/workers-ai-extractor.test.ts` — untrusted framing between `<<<PAGE`/`PAGE>>>` (spec llm-extraction: Page Content Is Framed as Untrusted), primary-then-fallback on invalid/unparseable output, quota-exhaustion mapping (spec: Workers AI Quota Exhaustion Is Reported and Non-Retrying), model ID regex validation.
- [ ] 8.2 GREEN: `src/adapters/llm/{workers-ai-extractor,prompt}.ts` with injected `run`.
- [ ] 8.3 RED/GREEN: `src/adapters/github/repo-metadata.ts` — public REST call, 3 s timeout, with test.

## Phase 9: Queue Adapter, Consumer Wiring, Handler Tests (PR9)

- [ ] 9.1 RED: `test/adapters/queue/analysis-job-queue.test.ts` — `Queue.send` failure maps to `QueueSendFailedError`.
- [ ] 9.2 GREEN: `src/adapters/queue/analysis-job-queue.ts`.
- [ ] 9.3 RED: `test/index.queue.test.ts` — `worker.queue(fakeBatch)` with fake `Message` (`ack`/`retry` spies): malformed body acked+logged, duplicate delivery no-op, retry uses `delaySeconds`, handler never throws.
- [ ] 9.4 GREEN: `src/index.ts` — `export default { fetch: app.fetch, queue }`, shape-validates message, maps `JobOutcome` to `ack`/`retry`.
- [ ] 9.5 GREEN: `src/composition.ts` — `buildHackathonConsumer(env)` (`new Api(BOT_TOKEN)`, no `PII_KEYRING`, mirrors `buildGithubRouter`).

## Phase 10: Publisher, Commands, Env, Wrangler (PR10)

- [ ] 10.1 RED/GREEN: `src/adapters/telegram/chat-publisher.ts` — `sendMessage` (optional thread), pin, unpin; `PublishFailedError` on unavailable/rate-limited, with test.
- [ ] 10.2 RED: `test/adapters/telegram/commands.test.ts` — `/hackathon <url>` ack reply (spec: Admin runs a fresh analysis), non-admin refusal, `/hackathon <slug>` re-show + link/pin in topic, `/hackathon` no-arg linked vs unlinked (spec: No-Argument Behavior), `/hackathons` truncated listing, plain-text/4096 cap on every reply (spec: Plain Text Replies).
- [ ] 10.3 GREEN: `src/adapters/telegram/commands.ts` — register `/hackathon`, `/hackathons`; `command-outcome.ts` reason passthrough.
- [ ] 10.4 Modify `src/env.ts`, `wrangler.jsonc`, `package.json` — `AI`, `BROWSER`, `HACKATHON_QUEUE` bindings, `queues.producers`/`queues.consumers` (`max_batch_size: 1`, `max_retries: 2`, `retry_delay: 30`, `max_concurrency: 1`), `HACKATHON_MODEL_PRIMARY`/`HACKATHON_MODEL_FALLBACK` vars, `@cloudflare/puppeteer` dependency.

## Phase 11: Operator Rollout (Manual — Not Performed by Apply)

- [ ] 11.1 Run `npx wrangler queues create hackathon-analysis`.
- [ ] 11.2 Enable the Workers AI and Browser Rendering bindings for the Worker.
- [ ] 11.3 Give the bot the "can pin messages" right in the target chat(s).
- [ ] 11.4 Verify the exact `@cf/...` catalog IDs and context windows (≥10k tokens) for GLM-5.3-Flash and DeepSeek V4 Flash, and set them in `vars.HACKATHON_MODEL_PRIMARY`/`HACKATHON_MODEL_FALLBACK`.
- [ ] 11.5 Apply the D1 migration remotely, deploy, smoke-test `/hackathon <url>` in general chat then in a topic.
