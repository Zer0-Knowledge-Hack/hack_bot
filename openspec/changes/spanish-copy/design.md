# Design: Spanish Bot Copy

## Technical Approach

This is a copy-only change. Every bot-authored Telegram string moves into one of two plain TypeScript catalogs, one per hexagonal layer, and is translated to neutral, professional Spanish using the **tú** form (never usted or voseo). Each call site replaces its inline literal with a catalog entry. Interpolated codes (role, GitHub kind/action, fetch kind, link/unlink) go through exhaustive typed maps, so a new code fails `npm run typecheck`. Page values, the LLM prompt, identifiers, log events and codes, and domain exception messages stay unchanged (specs `bot-copy` and the `hackathon-analysis` delta). The only non-copy edit is that `reposReply` now delegates to `joinLinesWithinLimit`, which uses the same algorithm, so only one "…y N más" implementation remains.

## Architecture Decisions

| Topic | Choice | Rejected (tradeoff) |
|---|---|---|
| Catalog layout | `src/domain/copy.ts` holds text the domain authors: analysis labels, list markers, job outcomes, link notes, the ack, the truncation line, fetch phrases, GitHub alert header and labels. `src/adapters/telegram/copy.ts` holds command replies, usage, error maps, picker text and role labels. The adapter catalog imports the domain catalog, never the other way round | One catalog in `src/` (the domain would import adapter text, or the adapter would own domain text). Editing strings in place (duplicates drift, and there are ~115 sites to proofread) |
| Shape | Nested `const` objects with string leaves. Interpolated text uses small arrow functions with typed params (`(slug: string) => string`). Code maps are `Readonly<Record<Code, string>>` literals | An i18n library or ICU templates (only one locale is needed; adds a dependency). A string-key lookup like `t("key")` (loses typing) |
| Exhaustiveness | Declared as `Record<Role,…>`, `Record<PageFetchFailureKind,…>` and `Record<\`${GithubEventKind}:${GithubEventAction}\`,…>`. A missing key or an extra key is a compile error | `switch` with a default branch (a new code silently falls back) |
| GitHub combos | All 8 template-literal keys are present. `issues:merged` and `issues:review_requested` are never produced by the mapper, but the domain type allows them, so they get safe phrases and a comment | Tightening `GithubEvent` into a discriminated union (a behavior-adjacent type change, out of scope) |
| Shared strings | "Only public http(s)…" and "not configured" live in the domain catalog (`analysisCopy.unsafeUrl`, `analysisCopy.notConfigured`); `ERROR_REPLIES` references them. "Not a member" (×4) is `commonCopy.notMember` and "No team is registered…" (×2) is `commonCopy.noTeamForChat`, both in the adapter catalog. "Se vinculó X a este tema." is `commonCopy.linkedHere(name)`, used by `/linkrepo` and `/hackathon <slug>` | Keeping duplicates (they drift) |
| "…y N más" | `domainCopy.moreItems(n)` is the only template. `reposReply` becomes `joinLinesWithinLimit(lines, REPLY_MAX, repoCopy.none)`. The loop is byte-identical, and the existing `/repos` truncation tests guard it | Two loops that each import `moreItems` (the duplicate algorithm remains) |
| Admin refusals | Every one uses the spec pattern "Solo un administrador del equipo puede …". `/setup` says "…del grupo de Telegram…", because it checks the Telegram group admin | Mixed phrasings |
| Tests | Tests assert literal Spanish strings. They never import the catalogs, so a catalog typo fails a test | Asserting against catalog imports (tautological) |

## Data Flow

```
domain use case ── domainCopy ──▶ replyText / publisher.post ─┐
adapter command ── telegramCopy ─(imports domainCopy)─────────┼─▶ ctx.reply / sendMessage (plain, ≤4096)
github route ── formatGithubAlert ── GITHUB_ALERT_HEADERS ─────┘
```

## Copy Table (verbatim for apply and tests)

`{x}` marks an interpolated value. Loanwords that stay: slug, PR, Issue, URL, http(s), UTC, and the command and argument keywords.

**Domain: `src/domain/copy.ts`**

| Site | English | Spanish |
|---|---|---|
| format labels | Slug / Name / Format / Location / Team size | Slug / Nombre / Formato / Ubicación / Tamaño del equipo |
| | Submission deadline / Start date / End date / Results date | Fecha límite de entrega / Fecha de inicio / Fecha de fin / Fecha de resultados |
| | Prizes / Tracks / Eligibility / Suggested repos | Premios / Categorías / Requisitos / Repositorios sugeridos |
| list markers | (unnamed) / no deadline found / linked / not linked | (sin nombre) / sin fecha límite / vinculado / no vinculado |
| list empty | No hackathons analyzed yet. | Todavía no se ha analizado ningún hackathon. |
| text-limit | ...and {n} more | …y {n} más |
| request ack | Analyzing {host}… the result will be posted here. | Analizando {host}… el resultado se publicará aquí. |
| job | The saved analysis could not be found; run it again. | No se encontró el análisis guardado; ejecútalo de nuevo. |
| | Analysis expired; run it again. | El análisis caducó; ejecútalo de nuevo. |
| | Only public http(s) pages can be analyzed. | Solo se pueden analizar páginas públicas http(s). |
| | Could not read that page ({kind}). Any previous analysis was kept. | No se pudo leer esa página ({frase}). Se conservó el análisis anterior. |
| | The page has too little readable text. Previous analysis kept. | La página tiene muy poco texto legible. Se conservó el análisis anterior. |
| | Today's shared AI quota is used up; try after 00:00 UTC. Previous analysis kept. | Se agotó la cuota compartida de IA de hoy; inténtalo después de las 00:00 UTC. Se conservó el análisis anterior. |
| | The AI could not produce a valid analysis. Previous analysis kept. | La IA no pudo generar un análisis válido. Se conservó el análisis anterior. |
| | Hackathon analysis is not configured. | El análisis de hackathons no está configurado. |
| | The analysis failed due to a temporary error. Try again later. | El análisis falló por un error temporal. Inténtalo de nuevo más tarde. |
| link notes | Replaced the topic's previous link (was {slug}). | Se reemplazó el vínculo anterior del tema (era {slug}). |
| | Moved this analysis's link from another topic. | Se movió el vínculo de este análisis desde otro tema. |
| | Pinning failed; the message was posted unpinned. | No se pudo fijar el mensaje; se publicó sin fijar. |
| fetch kinds | timeout / too-large / http-status | tiempo de espera agotado / la página es demasiado grande / el sitio respondió con un error |
| | content-type / redirects / network | el contenido no es una página web / demasiadas redirecciones / error de red |
| GitHub header `{repo} — {h}` | pull_request: opened / closed / merged / review_requested | PR abierto / PR cerrado / PR fusionado / Revisión solicitada |
| | issues: opened / closed / (merged) / (review_requested) | Issue abierto / Issue cerrado / Issue fusionado / Revisión solicitada |
| GitHub labels | Reviewer: / By: | Revisor: / Por: |

**Adapter: `src/adapters/telegram/copy.ts`**

| Site | English | Spanish |
|---|---|---|
| common | You are not a member of this team. | No eres miembro de este equipo. |
| | No team is registered for this chat. Ask an admin to run /setup. | No hay ningún equipo registrado en este chat. Pide a un administrador que ejecute /setup. |
| | Could not verify your team membership. Please try /{cmd} again. | No se pudo verificar tu pertenencia al equipo. Vuelve a intentar /{cmd}. |
| | Linked {x} to this topic. | Se vinculó {x} a este tema. |
| roles | admin / member | administrador / miembro |
| team resolution | Join a team first by running /join in its group. | Primero únete a un equipo ejecutando /join en su grupo. |
| | Choose which team this command applies to. / button Team {id} | Elige a qué equipo se aplica este comando. / Equipo {id} |
| /setup | Run /setup inside the group you want to register as a team, not in a private chat. | Ejecuta /setup dentro del grupo que quieres registrar como equipo, no en un chat privado. |
| | You are posting as an anonymous admin, so your admin status cannot be verified. Turn off "Remain anonymous" in your admin rights and run /setup again. | Estás publicando como administrador anónimo, así que no se puede verificar tu condición de administrador. Desactiva "Permanecer anónimo" en tus permisos de administrador y vuelve a ejecutar /setup. |
| | A team is already registered for this chat. | Ya hay un equipo registrado en este chat. |
| | Could not verify your admin status. Please try again. | No se pudo verificar tu condición de administrador. Inténtalo de nuevo. |
| | Only a Telegram group admin can run /setup. | Solo un administrador del grupo de Telegram puede ejecutar /setup. |
| | Team created. You are the first admin. | Equipo creado. Eres el primer administrador. |
| /join | You are already a member of this team. / You joined the team. | Ya eres miembro de este equipo. / Te uniste al equipo. |
| /datachannel | Run /datachannel inside the topic you want to use as the team's data channel. | Ejecuta /datachannel dentro del tema que quieres usar como canal de datos del equipo. |
| | Only a team admin may bind the data channel. | Solo un administrador del equipo puede asignar el canal de datos. |
| | This topic is now the team's data channel. | Este tema es ahora el canal de datos del equipo. |
| /profile | unreadable | ilegible |
| | Member {id}{identity} — role: {role} | Miembro {id}{identity} — rol: {rol} |
| | No profile fields set. | No hay campos de perfil configurados. |
| | Team {id} / No matching member found. | Equipo {id} / No se encontró ningún miembro que coincida. |
| | Member data is available only in the team's data channel. | Los datos de los miembros solo están disponibles en el canal de datos del equipo. |
| | Usage: /profile set <full_name\|emails\|social_links\|github_username> <value> | Uso: /profile set <full_name\|emails\|social_links\|github_username> <valor> |
| | You may only edit your own profile. | Solo puedes editar tu propio perfil. |
| | Profile updated for team {id}. | Perfil actualizado para el equipo {id}. |
| | Usage: /profile show [membership-id] or /profile set <field> <value> | Uso: /profile show [membership-id] o /profile set <campo> <valor> |
| /promote /demote | Usage: /{cmd} <membership-id> | Uso: /{cmd} <membership-id> |
| | Only a team admin may change roles. | Solo un administrador del equipo puede cambiar roles. |
| | Member not found in this team. | No se encontró al miembro en este equipo. |
| | The last team admin cannot be demoted. | No se puede degradar al último administrador del equipo. |
| | Member role changed to {role} for team {id}. | Rol del miembro cambiado a {rol} para el equipo {id}. |
| link/unlink (`Record<"link"\|"unlink">`) | Run /linkrepo inside the topic you want to link. | Ejecuta /linkrepo dentro del tema al que quieres vincular el repositorio. |
| | Run /unlinkrepo inside the topic you want to unlink. | Ejecuta /unlinkrepo dentro del tema del que quieres desvincular el repositorio. |
| | Usage: /{cmd} <owner/repo or GitHub repo URL> | Uso: /{cmd} <owner/repo o URL del repositorio de GitHub> |
| /linkrepo | Only a team admin may link a repo. | Solo un administrador del equipo puede vincular un repositorio. |
| | This repo's org is not claimed by your team. | La organización de este repositorio no está reclamada por tu equipo. |
| | Moved {repo} from topic {a} to topic {b}. Topic {a} will no longer receive alerts for this repo. | Se movió {repo} del tema {a} al tema {b}. El tema {a} ya no recibirá alertas de este repositorio. |
| /unlinkrepo | Only a team admin may unlink a repo. | Solo un administrador del equipo puede desvincular un repositorio. |
| | Unlinked {repo} from this topic. / {repo} was not linked to any topic. | Se desvinculó {repo} de este tema. / {repo} no estaba vinculado a ningún tema. |
| /repos | No repos linked yet. / {repo} -> topic {id} | Todavía no hay repositorios vinculados. / {repo} -> tema {id} |
| picker | That team is not available to you. / You are not a member of that team. | Ese equipo no está disponible para ti. / No eres miembro de ese equipo. |
| | Team selected. Run your command again to continue. | Equipo seleccionado. Vuelve a ejecutar tu comando para continuar. |
| /hackathon | Usage: /hackathon <url or slug> | Uso: /hackathon <url o slug> |
| | Run this command inside your team's group chat. | Ejecuta este comando dentro del chat grupal de tu equipo. |
| | Only a team admin may analyze or link a hackathon. | Solo un administrador del equipo puede analizar o vincular un hackathon. |
| | No analysis with that slug. See /hackathons. | No hay ningún análisis con ese slug. Consulta /hackathons. |
| | That URL is too long (max {n} characters). | Esa URL es demasiado larga (máximo {n} caracteres). |
| | Daily limit reached (5 new analyses per UTC day). Re-showing a slug is free. | Límite diario alcanzado (5 análisis nuevos por día UTC). Volver a mostrar un slug no cuenta. |
| | An analysis is already running for this team. Wait for its result. | Ya hay un análisis en curso para este equipo. Espera su resultado. |
| | Could not start the analysis; try again in a minute. This did not count toward the daily limit. | No se pudo iniciar el análisis; inténtalo de nuevo en un minuto. No se contó en el límite diario. |
| | Could not post to this chat right now. Try again in a minute. | No se pudo publicar en este chat ahora mismo. Inténtalo de nuevo en un minuto. |

## Length (4096 cap)

Every fixed string is under 300 chars. The dynamic paths keep their existing guards: `formatAnalysis` → `truncate(REPLY_MAX)`, `withNotes` reserves the notes and truncates only the body, `/hackathons` and `/repos` → `joinLinesWithinLimit`, and `formatGithubAlert` → `truncate(4096)`. "…" is one UTF-16 unit (the old "..." was 3), so the summary line is shorter than before and the loop invariant `candidate.length ≤ limit` still holds. All the Spanish characters are in the BMP. `/profile show` has no cap; that issue predates this change and is **out of scope**.

## File Changes

| File | Action | PR |
|---|---|---|
| `src/domain/copy.ts` | Create (hackathon sections) → extended with GitHub in PR3 | 1, 3 |
| `src/adapters/telegram/copy.ts` | Create (`commonCopy.notMember`, `linkedHere`, hackathon) → extended in PR2 | 1, 2 |
| `src/domain/hackathon/format.ts`, `src/domain/text-limit.ts` | Modify: labels, markers, `moreItems`. `FIELD_LABELS` moves to the catalog with the **same key order** (it drives line order) | 1 |
| `src/domain/usecases/{run-hackathon-job,link-analysis-to-topic,request-hackathon-analysis}.ts` | Modify | 1 |
| `src/adapters/telegram/hackathon-commands.ts` | Modify | 1 |
| `src/adapters/telegram/commands.ts`, `team-picker.ts` | Modify (including the `reposReply` delegation) | 2 |
| `src/domain/github.ts` | Modify: header map and labels | 3 |
| `test/copy/catalog-language.test.ts` | Create; its scope grows per PR | 1–3 |

## Testing Strategy (Strict TDD)

| Layer | What | Approach |
|---|---|---|
| RED first | For each slice, change the exact-string assertions to Spanish before touching `src`: `test/domain/{text-limit,hackathon/format,github}.test.ts`, `test/domain/usecases/{list-analyses,link-analysis-to-topic,run-hackathon-job}.test.ts`, `test/index.queue.test.ts`, `test/http/hackathon-command-e2e.test.ts`, `test/adapters/telegram/commands.test.ts`. The truncation regexes become `/…y \d+ más$/`. New cases: all 6 fetch phrases, the header for each GitHub combo, and role labels in `/profile show` and `/promote` | Vitest, literal strings |
| Guard | `catalog-language.test.ts` walks both catalogs, calls each function with sample args, and asserts no value matches the English denylist `/\b(the\|you\|your\|only\|could\|please\|run\|usage\|team\|member\|topic\|linked\|analysis\|page\|try)\b/i`. Allowed loanwords do not collide (`membership-id` does not match `\bmember\b`). It also checks that every code map has non-empty values | Unit |
| Exhaustiveness | Adding a role, fetch kind or GitHub action without copy fails `npm run typecheck` | `tsc --noEmit` |
| Verify | `rg` over `src/` for the former English fragments in this table (comments excluded) returns nothing. `prompt.test.ts` stays unchanged | verify phase |

No `npm run harness` run is needed: fetch, LLM and validation are untouched.

## Threat Matrix

N/A: no routing, shell, subprocess, VCS/PR automation, executable-file classification or process-integration boundary. Only static strings change.

## Migration / Rollout

No migration is required. There are 3 chained PRs (each ≤400 lines), and each leaves its area fully Spanish with the suite green:
1. The domain catalog and hackathon (the use cases, format, text-limit, hackathon-commands, and the adapter catalog seed).
2. The profile, team, membership and repo commands and the team picker (commands.ts, team-picker.ts, and the `reposReply` delegation).
3. GitHub alerts (github.ts).

Between PR1 and PR2, `/repos` still prints the English "...and N more". That is acceptable, because the area moves together in PR2. Rollback: revert the PRs.

## Open Questions

- [ ] Confirm the Telegram Spanish UI label for "Remain anonymous" ("Permanecer anónimo" is assumed).
