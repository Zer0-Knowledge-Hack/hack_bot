# Proposal: Hackathon Analysis with Slugs and Optional Topic Pinning

## Intent

Teams analyze a hackathon in the general chat to decide whether to join, and create a forum topic only if they go. Reading event pages by hand is slow. `/hackathon <url>` extracts format, team cap, dates, prizes and tracks, stores the result under a short slug, and pins it to a topic once one exists. Free Cloudflare quotas only. Roadmap change 3.

## Scope

### In Scope
- `/hackathon <url>` (admin-only, general chat or topic): fetch + LLM run, reply with analysis and slug. Inside a topic, also link and pin. Counts against the cap.
- `/hackathon <slug>` (any member): re-show, no cap. Admin inside a topic: also link and pin.
- `/hackathon` inside a linked topic: re-show; otherwise usage.
- `/hackathons` (any member): slug, name, key deadline, linked or not; truncated to 4096 chars like `/repos`.
- Argument rule: slugs match `^[a-z0-9]+(-[a-z0-9]+)*$` and never contain `.` or `:`; anything with a scheme or a dot is a URL.
- Slug from hackathon name (fallback: URL host), unique per team, numeric suffix on collision (`meridian-2`).
- Same (normalized) URL in the same team refreshes the analysis and keeps its slug.
- Nullable `thread_id`; at most one analysis per topic.
- Static fetch with SSRF, size and time guards; Browser Rendering fallback under the same policy.
- Workers AI behind `LlmExtractor`; strict validation; nullable fields, never guessed.
- D1 with bounded snippets, no raw page. Failed re-analysis keeps the stored analysis.
- Suggestions only from `/linkrepo` repos plus public GitHub metadata.
- Per-team daily cap on fetch+LLM runs only.
- Clear failures for quota, schema, fetch and missing pin rights (posted unpinned).
- Plain text, at most 4096 chars.

### Out of Scope
- Key-date reminders and digests (cron)
- A manual project registry
- Several hackathons per topic
- Paid LLMs or API keys

## Capabilities

### New Capabilities
- `hackathon-analysis`: commands, permissions, slugs, URL refresh, topic linking, pinning, listing, cap, format
- `page-fetch`: guards, text reduction, browser fallback and quota
- `llm-extraction`: schema, validation, null-over-guess, snippets, failures

### Modified Capabilities
- None. `repo-topic-links` is only read.

## Approach

Pure use cases `analyzeHackathon`, `showAnalysis`, `linkAnalysisToTopic`, `listAnalyses` over ports `PageFetcher`, `LlmExtractor`, `HackathonAnalysisRepo`, `RepoMetadataSource`. A pure argument classifier and slug generator. Page text framed as untrusted. Replies reuse the plain-text truncation pattern.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/domain/` | Modified | Entity, slug, classifier, ports, use cases |
| `src/adapters/{http,llm,browser}/` | New | Fetcher, extractor, renderer |
| `src/adapters/d1/`, `migrations/0003_*.sql` | New | Analyses (unique slug, URL, thread per team), cap |
| `src/adapters/telegram/commands.ts` | Modified | `/hackathon`, `/hackathons`, pin |
| `wrangler.jsonc`, `src/env.ts`, `src/composition.ts` | Modified | `ai`, `browser` bindings |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Shared quotas run out | Med | Cap, clear messages |
| Invalid model JSON | Med | Strict validation |
| Prompt injection | Med | Untrusted framing, schema-only output |
| SSRF, rebinding, browser redirects | Low | Denylist, request interception |
| URL variants duplicate analyses | Med | Normalize URL before lookup |
| Weak open-model extraction | Med | Snippets, "verify manually" footer |

## Rollback Plan

Redeploy the previous Worker; remove `ai` and `browser` bindings. Migration only adds tables; drop after export.

## Dependencies

- Workers AI and Browser Rendering enabled
- Bot "can pin messages" right (operator step)

## Success Criteria

- [ ] Non-admins cannot run analyses or link topics
- [ ] General-chat analysis replies with a slug, unpinned
- [ ] Admin `/hackathon <slug>` in a topic links and pins, without using cap
- [ ] Same URL refreshes and keeps its slug; failure keeps the old analysis
- [ ] `/hackathons` lists within 4096 chars
- [ ] Thin JS page triggers the browser fallback
- [ ] Private or loopback URLs are rejected
- [ ] Domain has no Workers AI, Puppeteer or grammY imports

## Proposal question round

Applied: all prior decisions, general-chat workflow, slugs, re-show free of cap, keep-on-failure. Open:
1. Daily cap per team (proposed: 5 runs).
2. Linking conflicts: when the topic already has a different analysis, or the analysis is linked elsewhere, move the link and unpin the old message (proposed), or refuse?
