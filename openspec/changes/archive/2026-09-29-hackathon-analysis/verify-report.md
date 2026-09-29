# Verify Report: hackathon-analysis

Base: `main` @ bf43602 (PRs #20-#37 merged). Mode: openspec, Strict TDD.

## Verdict: PASS WITH WARNINGS
0 CRITICAL, 3 WARNING, 6 SUGGESTION (non-blocking follow-ups). Archive is blocked only by operator items (see "Blocks archive").

## Evidence
- `npm test`: 70 files passed, 803 tests passed, 0 failed (~48 s).
- `npm run typecheck` (`tsc --noEmit`): clean, no errors.

## tasks.md
- Phases 1-10: done.
- 11.1 done. 11.4 done (models revised to Free-plan `glm-4.7-flash` / `qwen3-30b-a3b-fp8`).
- 11.2 unchecked in tasks.md but confirmed by evidence (AI + Browser bindings work in production and on the Cloudflare harness). Checkbox should be ticked.
- 11.3 pending (operator: bot "can pin messages" right).
- 11.5 unchecked: passed in production for bnb-ai-hack; tokenized-stocks passed on the production-faithful harness after PR #37; final Telegram confirmation pending Browser Rendering daily-quota reset.

## Design/spec consistency (grep spot-checks)
- wrangler.jsonc: `HACKATHON_MODEL_PRIMARY=@cf/zai-org/glm-4.7-flash`, `HACKATHON_MODEL_FALLBACK=@cf/qwen/qwen3-30b-a3b-fp8`, `max_retries: 5` - OK.
- workers-ai-extractor.ts: chat `messages` input, `max_tokens` 2500 (comment; passed as `MAX_TOKENS`) - OK.
- analyze-hackathon.ts: `BOT_WALL_STATUSES = {401,403,429,503}` - OK.
- extraction.ts: per-field `wrong-shape` rejection - OK.
- `normalizePageText` in html-to-text.ts, used by the static HTML path and rendered-fetcher.ts - OK.

## Coverage table (keyword mapping; file hits in test/)
| Spec requirement / scenario | Covering tests | Status |
|---|---|---|
| Admin-only fresh analysis (admin / non-admin) | request-hackathon-analysis, command-outcome, hackathon-command-e2e | Covered |
| Member re-shows by slug (member / admin in topic) | show-analysis, argument, e2e | Covered |
| No-argument (linked topic / nothing linked) | show-topic-analysis, argument | Covered |
| Slug vs URL classification | argument.test.ts, url.test.ts | Covered |
| Slug generation + collision suffix | slug.test.ts, hackathon-analysis-repo | Covered |
| Same-URL refresh keeps slug | run-hackathon-job / repo (refresh) | Covered |
| Failed re-analysis keeps prior result | no explicit keyword hit | WARNING (verify by inspection; likely structural: persist only on success) |
| One analysis per topic / conflicts move link | link-analysis-to-topic | Covered |
| Pin failure falls back to unpinned | pin hits in commands, run-hackathon-job, link-analysis | Covered |
| Daily cap | analysis-quota, request-hackathon-analysis | Covered |
| Job safety: running / enqueue failure / duplicate / retries exhausted | request-hackathon-analysis, run-hackathon-job (line 406), queue tests | Covered |
| Listing read-only + truncated | list-analyses, text-limit | Covered |
| Plain text replies | format.test.ts, commands | Covered |
| Strict schema (well-formed / malformed / per-field / null-not-found) | extraction.test.ts, workers-ai-extractor.test.ts (incl. GLM null fields, line 363) | Covered |
| Null over guess | extraction.test.ts | Covered |
| Snippet per non-null field (present / flattened ws / absent / null) | extraction.test.ts | Covered |
| Untrusted page framing | prompt.test.ts | Covered |
| Distinct schema-failure error | analyze-hackathon.test.ts (line 290), run-hackathon-job | Covered |
| Workers AI quota exhaustion non-retrying | workers-ai-extractor, run-hackathon-job | Covered |
| Scheme/destination guard (static + browser + redirect) | safe-fetcher, rendered-fetcher, url.test.ts | Covered |
| Size cap / time cap | safe-fetcher.test.ts lines 152, 171 | Covered |
| Thin text triggers browser fallback / sufficient skips | analyze-hackathon.test.ts | Covered |
| Bot-wall triggers fallback / 404 does not / browser fails after bot-wall | analyze-hackathon.test.ts (line 165) | Covered |
| Browser 429 with usable / insufficient static text | analyze-hackathon.test.ts | Covered |
| No raw page stored or logged (bounded output; safe fetch-error log) | run-hackathon-job.test.ts 481-561 (SECRET/example.com not logged), safe-logger | Covered (no-storage half by inspection: WARNING-level evidence) |

Uncovered by keyword: "Failed re-analysis keeps prior result" (no explicit test found), "successful analysis stores only bounded output" (no explicit assertion found).

## Warnings
1. No explicit test for "Failed re-analysis keeps the prior result".
2. No explicit test asserting only bounded output is stored (raw page never persisted).
3. tasks.md checkbox 11.2 not ticked despite confirmed evidence.

## Non-blocking follow-ups
- R3-001: an all-null extraction counts as usable.
- R3-002: the text/plain static path is not normalized with `normalizePageText`.
- R3-003: escape test gap.
- 405 is not in the bot-wall set.
- The harness always runs the rendered fetch.
- A claimed-job transient retry keeps the claim.

## Blocks archive
- 11.3: operator must grant the bot the "can pin messages" right.
- 11.5 final confirmation: tokenized-stocks Telegram smoke test after the Browser Rendering daily quota resets (production-faithful harness already passed).
- (Housekeeping) tick 11.2 in tasks.md.

## Post-verify update

Archive blockers 11.3 and 11.5 are now resolved:

- **11.3 resolved** (2026-09-29): The bot was promoted to group ADMINISTRATOR with "Pin Messages" right. Verified: first topic run (topic 262) had `pinned_message_id: null` while the bot was only a member; after promotion, `pinned_message_id: 271`.
- **11.5 resolved** (2026-09-29): Smoke test passed on production. General chat runs: bnb-ai-hack and tokenized-stocks. Topic run: link and pin via `/hackathon bnb-hack-tokenized-stocks-edition`. All production fixes from PRs #33–#37 documented in apply-progress.md.

**Verdict remains**: PASS WITH WARNINGS with 0 CRITICAL blockers. Archive may proceed.

**Additional non-blocking follow-up**:
- When the pin fails on a fresh run through the queue consumer (`postAnalysisAndLinkTopic` in src/domain/usecases/run-hackathon-job.ts), the "Pinning failed" note is dropped, so the user is not told. Consider surfacing pin failure in the linked message or via a separate notification.
