# Tasks: Spanish Bot Copy

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~450-550 (PR1 ~260, PR2 ~220, PR3 ~60) |
| 400-line budget risk | Medium (aggregate); each PR Low-Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR1 domain catalog + hackathon → PR2 profile/team/repo commands + picker → PR3 GitHub alerts |
| Delivery strategy | 3 chained PRs (decided in proposal/design) |
| Chain strategy | stacked-to-main (each PR targets `main` after the previous merges) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

No `npm run harness` needed: fetch, LLM and validation logic are unchanged; fetch phrases are copy only.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Domain catalog + hackathon area Spanish | PR1 (~260) | `npm test -- test/domain test/copy test/index.queue.test.ts test/http/hackathon-command-e2e.test.ts` | N/A — copy only | `src/domain/copy.ts`, hackathon call sites, adapter catalog seed |
| 2 | Profile/team/membership/repo commands + picker Spanish | PR2 (~220) | `npm test -- test/adapters/telegram` | N/A — copy only | `commands.ts`, `team-picker.ts`, adapter catalog additions |
| 3 | GitHub alerts Spanish | PR3 (~60) | `npm test -- test/domain/github.test.ts test/copy` | N/A — copy only | `src/domain/github.ts`, its catalog section |

## Phase 1: Domain Catalog + Hackathon (PR1)

- [x] 1.1 RED: `test/domain/text-limit.test.ts` — truncation regex `/…y \d+ más$/`; run, see fail.
- [x] 1.2 RED: `test/domain/hackathon/format.test.ts` — Spanish labels, markers, empty list (design table); values stay verbatim.
- [x] 1.3 RED: `test/domain/usecases/{run-hackathon-job,link-analysis-to-topic,list-analyses}.test.ts` — Spanish outcomes/notes; add all 6 fetch phrases (timeout, too-large, `http-status` = "el sitio respondió con un error", content-type, redirects, network), none showing raw codes.
- [x] 1.4 RED: `test/index.queue.test.ts`, `test/http/hackathon-command-e2e.test.ts`, `test/adapters/telegram/commands.test.ts` (hackathon cases only) — ack "Analizando {host}… el resultado se publicará aquí.", usage, refusals, cap, busy, enqueue failure, link ack.
- [x] 1.5 RED: create `test/copy/catalog-language.test.ts` — walk catalogs, call builders with sample args, assert no English denylist match and non-empty code maps (scope: domain catalog + hackathon adapter entries).
- [x] 1.6 GREEN: create `src/domain/copy.ts` — `analysisCopy`, `FIELD_LABELS` (same key order), markers, `moreItems`, job outcomes, link notes, `Record<PageFetchFailureKind,string>` fetch phrases.
- [x] 1.7 GREEN: `src/domain/hackathon/format.ts`, `src/domain/text-limit.ts` use the catalog.
- [x] 1.8 GREEN: `src/domain/usecases/{run-hackathon-job,link-analysis-to-topic,request-hackathon-analysis}.ts` use the catalog.
- [x] 1.9 GREEN: create `src/adapters/telegram/copy.ts` seed (`commonCopy.notMember`, `linkedHere`, hackathon strings; imports domain catalog); wire `src/adapters/telegram/hackathon-commands.ts` incl. `ERROR_REPLIES`.
- [x] 1.10 Run `npm test` and `npm run typecheck`; area fully Spanish, green.

## Phase 2: Profile, Team, Membership, Repo Commands + Picker (PR2)

- [x] 2.1 RED: `test/adapters/telegram/commands.test.ts` — Spanish assertions for /setup, /join, /datachannel, /profile, /promote, /demote, /linkrepo, /unlinkrepo, /repos, team resolution; add role labels ("administrador"/"miembro") in `/profile show` and `/promote`; `/repos` truncation `/…y \d+ más$/`.
- [x] 2.2 RED: `test/adapters/telegram/team-picker` tests (or nearest existing file) — callback alerts and "Equipo {id}" button.
- [x] 2.3 RED: extend `test/copy/catalog-language.test.ts` to the full adapter catalog incl. `Record<Role,string>`, link/unlink map; run, see fail.
- [x] 2.4 GREEN: extend `src/adapters/telegram/copy.ts` (tú form, "tema", role and link/unlink `Record` maps, shared `noTeamForChat`).
- [x] 2.5 GREEN: `src/adapters/telegram/commands.ts` uses catalog; `reposReply` delegates to `joinLinesWithinLimit(lines, REPLY_MAX, repoCopy.none)`.
- [x] 2.6 GREEN: `src/adapters/telegram/team-picker.ts` uses catalog.
- [x] 2.7 Run `npm test` and `npm run typecheck`.

## Phase 3: GitHub Alerts (PR3)

- [x] 3.1 RED: `test/domain/github.test.ts` — header per combo (`pull_request`: PR abierto/PR cerrado/PR fusionado/Revisión solicitada; `issues`: Issue abierto/Issue cerrado/…), labels "Revisor:"/"Por:", no raw codes, ≤4096.
- [x] 3.2 RED: extend `test/copy/catalog-language.test.ts` to `GITHUB_ALERT_HEADERS` (all 8 keys non-empty).
- [x] 3.3 GREEN: `src/domain/copy.ts` — `Record<\`${GithubEventKind}:${GithubEventAction}\`,string>` with comment on unused `issues:merged`/`issues:review_requested`.
- [x] 3.4 GREEN: `src/domain/github.ts` uses header map and labels.
- [x] 3.5 Run `npm test` and `npm run typecheck`.

## Phase 4: Final Verification (after PR3)

- [x] 4.1 `rg` over `src/` (comments excluded) for former English fragments (e.g. "Only a team admin", "not a member", "Usage:", "Analyzing", "and \{?n\}? more", "Reviewer:", "topic") on all reply paths; expect none.
- [x] 4.2 Confirm `prompt.test.ts` unchanged; run `npm test` and `npm run typecheck`, both green.
