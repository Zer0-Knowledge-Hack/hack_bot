# Bot Copy Specification

## Purpose

Defines the language and format of all bot-authored Telegram text: neutral, professional Spanish, plain text, within the Telegram length cap, with external values left verbatim.

## Requirements

### Requirement: Spanish-Only Bot-Authored Text

The system MUST write every bot-authored user-facing Telegram text (replies, refusals, usage lines, labels, list markers, empty-list text, callback alerts, job outcomes, link notes, alert headers) in neutral, professional Spanish. No English sentence or label authored by the bot MAY reach Telegram. Loanwords "slug", "PR" and "Issue" are allowed. The Telegram concept "topic" MUST be written "tema". Roles MUST display as "administrador" and "miembro"; stored role values MUST NOT change.

#### Scenario: Refusal is in Spanish

- GIVEN the caller is not a team admin
- WHEN they run `/hackathon <url>`
- THEN the reply is "Solo un administrador del equipo puede analizar o vincular un hackathon."

#### Scenario: Role display

- GIVEN a member has the stored role `admin` and another has `member`
- WHEN a reply shows their roles
- THEN it shows "administrador" and "miembro" respectively, never `admin` or `member`

#### Scenario: Topic wording

- WHEN any reply refers to a Telegram forum topic
- THEN it uses "tema", never "topic"

### Requirement: Page-Derived Values Stay Verbatim

The system MUST NOT translate, rewrite or localize values that originate outside the bot: extracted field values, snippets, hackathon names and any text taken from a web page or from GitHub. Only the bot's own labels and framing around them are Spanish.

#### Scenario: English page keeps its values

- GIVEN an analysis whose extracted `location` value is "Online" and deadline snippet is "Submissions close June 1"
- WHEN the analysis is formatted for Telegram
- THEN the labels are Spanish
- AND "Online" and "Submissions close June 1" appear unchanged

### Requirement: Code, Prompt and Logs Stay English

The system MUST keep the LLM prompt, command names, argument keywords, identifiers, log events, log reason codes and domain exception messages in English. Copy changes MUST NOT alter extraction, validation or any behavior.

#### Scenario: Prompt unchanged

- WHEN a fresh analysis calls the LLM
- THEN the prompt is byte-identical to the pre-change prompt

#### Scenario: Log codes unchanged

- WHEN a command is refused
- THEN the log reason code (for example `BadArgument`) is the same English code as before

### Requirement: Plain Text Within the Telegram Cap

The system MUST send all bot-authored text as plain text (no `parse_mode`) and each message MUST be at most 4096 characters, including the Spanish truncation line.

#### Scenario: Longer Spanish copy still fits

- GIVEN a listing whose full Spanish text exceeds 4096 characters
- WHEN the reply is built
- THEN it is truncated with a "…y N más" line
- AND the reply is at most 4096 characters and sent without `parse_mode`

### Requirement: Technical Codes Are Never Shown Raw

The system MUST map every code interpolated into user-visible text to a Spanish phrase: page-fetch failure kinds, GitHub kind/action, and link/unlink verbs. Raw codes MUST NOT appear.

| Code | Displayed phrase |
|------|------------------|
| `timeout` | tiempo de espera agotado |
| `too-large` | la página es demasiado grande |
| `http-status` | el sitio respondió con un error |
| `content-type` | el contenido no es una página web |
| `redirects` | demasiadas redirecciones |
| `network` | error de red |

#### Scenario: Fetch failure shows a phrase

- GIVEN a fresh analysis fails with fetch kind `timeout`
- WHEN the failure reply is posted
- THEN it reads "No se pudo leer esa página (tiempo de espera agotado). Se conservó el análisis anterior."
- AND it does not contain "timeout"

#### Scenario: GitHub alert header

- GIVEN a pull request `opened` event and an issue `closed` event
- WHEN alerts are posted
- THEN the headers are "PR abierto" and "Issue cerrado"
- AND no raw `pull_request`, `opened` or `closed` code is shown

#### Scenario: Review requested header

- GIVEN a pull request `review_requested` event
- WHEN the alert is posted
- THEN the header is "Revisión solicitada"
