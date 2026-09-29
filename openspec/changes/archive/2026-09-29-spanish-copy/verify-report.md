# Verify Report: spanish-copy

**Verdict: PASS WITH WARNINGS** (0 CRITICAL, 3 WARNING, 1 SUGGESTION)

Verified on `main` at c15192b, after PRs #39, #40 and #41 were merged. Mirror of engram `sdd/spanish-copy/verify-report`.

## Evidence

- `npm test`: 71 files, 870/870 passing.
- `npm run typecheck`: clean.
- `tasks.md`: 24/24 checked. That is 10 + 7 + 5 + 2 across Phases 1–4, not the 20 stated in the tasks summary.
- The guard `test/copy/catalog-language.test.ts` covers both catalogs, `src/domain/copy.ts` and `src/adapters/telegram/copy.ts`.
- Exhaustive typed maps exist for roles, fetch-failure kinds, GitHub alert headers, analysis field labels and link/unlink phrases. A new code without copy fails the typecheck.
- The LLM prompt is not touched by this change.

## Coverage

| Requirement | Covered by |
|---|---|
| bot-copy: Spanish-Only Bot-Authored Text | Exact Spanish assertions across `test/adapters/telegram/commands.test.ts`, the domain use-case tests and `test/domain/github.test.ts`, plus the catalog language guard |
| bot-copy: Page-Derived Values Stay Verbatim | Format and use-case tests with page values (not the exact scenario sample, see W1) |
| bot-copy: Code, Prompt and Logs Stay English | Log-code assertions in the use-case and command tests (see W2) |
| bot-copy: Plain Text Within the Telegram Cap | text-limit, `/repos` and GitHub cap tests |
| bot-copy: Technical Codes Are Never Shown Raw | Exhaustive maps (roles, fetch kinds, GitHub headers) with exact-string tests |
| hackathon-analysis (8 MODIFIED requirements) | Exact Spanish strings asserted in the run-hackathon-job, link-analysis-to-topic, request-hackathon-analysis and list-analyses tests, plus the queue and e2e tests |

## Leftover-English grep

A grep of `src/` reply paths for common English reply fragments found hits only in internal places:
- domain exception messages, which are only logged;
- log events and reason codes;
- identifiers;
- comments.

None of these reach chat users. `runCommand` replies only through the Spanish `errorReplies` catalogs, and unrecognized errors are rethrown without text. `.message` is used only for `ConfigError`, inside log fields.

## Warnings

- **W1:** No test asserts the exact spec sample "Submissions close June 1". Verbatim page values are covered by other samples.
- **W2:** No test asserts the `BadArgument` log code. Other English log codes are asserted.
- **W3:** The label "Permanecer anónimo" for Telegram's "Remain anonymous" was assumed. It lives at `src/adapters/telegram/copy.ts:49` and is asserted in `commands.test.ts:237`. The user did not object. Worth checking against the real Spanish Telegram client.

## Suggestion

- The actual task count is 24, not 20. This is noted here for the archive.

## Blocks archive

None.
