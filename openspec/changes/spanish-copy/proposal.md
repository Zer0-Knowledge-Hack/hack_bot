# Proposal: Spanish Bot Copy

## Intent

The team speaks Spanish, but every bot reply, refusal, label and alert is English. Translate all bot-authored Telegram text to neutral, professional Spanish with no behavior change, before change 4 (`hackathon-participation`) so it starts in Spanish.

## Scope

### In Scope
- Every bot-authored string sent to Telegram (~100 distinct, ~115 sites):

| Area | Strings |
|------|---------|
| `adapters/telegram/commands.ts` (setup, join, datachannel, profile, promote/demote, linkrepo, unlinkrepo, repos, team resolution) | ~48 |
| `adapters/telegram/hackathon-commands.ts` (usage, group-only, `ERROR_REPLIES`, link ack) | ~13 |
| `adapters/telegram/team-picker.ts` (callback alert, replies) | 3 |
| `domain/hackathon/format.ts` (labels, list markers, empty list) | ~18 |
| `domain/text-limit.ts` ("...and N more") | 1 |
| `domain/usecases/run-hackathon-job.ts` (job outcomes) | 9 |
| `domain/usecases/link-analysis-to-topic.ts` (notes) | 3 |
| `domain/usecases/request-hackathon-analysis.ts` ("Analyzing…") | 1 |
| `domain/github.ts` (alert header and labels) | ~6 |

- Display labels for interpolated codes: roles, GitHub kind/action, page-fetch failure kind, link/unlink verb.
- Tests that assert exact copy (~11 files, mainly `test/adapters/telegram/commands.test.ts`).
- Cap: every reply stays plain text, 4096 chars or fewer.

### Out of Scope
- Extracted field values, snippets, LLM prompt, extraction, validation (no `npm run harness`)
- Command names, argument keywords (`show`, `set`, `full_name`), identifiers, logs, reason codes, domain exception messages
- i18n framework or locale switching
- `setMyCommands` (not in code; BotFather descriptions are an operator step)
- Capping `/profile show` length (pre-existing)

## Capabilities

### New Capabilities
- `bot-copy`: all bot-authored Telegram text is neutral Spanish; external values stay verbatim; plain text within 4096.

### Modified Capabilities
- `hackathon-analysis`: scenarios quote English copy ("Analyzing <host>…", "...and N more", "already running", "could not start").

Other specs describe replies semantically; unchanged.

## Approach

Plain-object catalogs, one per layer (hexagonal; domain never imports adapters):
- `src/domain/copy.ts`: domain-authored text (analysis labels, job outcomes, link notes, alert labels, truncation line) with small builder functions for interpolation.
- `src/adapters/telegram/copy.ts`: command replies, usage, error maps, picker text; reuses domain entries for shared strings ("Only public http(s) pages…", "not configured").

Tradeoff vs editing in place: +~120 lines and one indirection, but one proofreading surface, no drift in duplicates, and a home for change 4 copy. Tests keep literal Spanish strings, not catalog imports.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/domain/copy.ts`, `src/adapters/telegram/copy.ts` | New | Catalogs |
| Files in the inventory | Modified | Use catalog entries |
| `test/**` (~11 files) | Modified | Spanish assertions |
| `openspec/specs/hackathon-analysis` | Modified | Delta for quoted copy |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Longer copy exceeds 4096 | Low | Existing truncation; notes reserved in `withNotes` |
| Missed English string | Med | Inventory checklist; grep during verify |
| Accidental behavior change | Low | Copy-only diff; unchanged logic tests |
| Change 4 blocked | Med | Ship slices quickly |

## Rollback Plan

Revert the PRs. No data, schema, binding or config changes.

## Dependencies

- None. Blocks `hackathon-participation`.

## Delivery

~450-550 changed lines. Chained PRs: (1) domain catalog + hackathon; (2) profile/team/membership/repo commands + picker; (3) GitHub alerts.

## Success Criteria

- [ ] No English bot-authored text reaches Telegram (inventory complete)
- [ ] Extracted values and snippets unchanged
- [ ] All replies plain text, 4096 chars or fewer
- [ ] Test suite green with Spanish assertions; no logic diffs

## Proposal question round

Assumptions needing review (defaults applied):
1. Roles display as "administrador"/"miembro"; stored role values stay `admin`/`member`.
2. GitHub header maps codes to Spanish ("Pull request abierto", "Issue cerrado", "Revisión solicitada").
3. Fetch failure kind shows a Spanish phrase ("tiempo de espera agotado"), not the raw code.
4. Loanwords "slug", "pull request" and "issue" stay; "topic" becomes "tema".
