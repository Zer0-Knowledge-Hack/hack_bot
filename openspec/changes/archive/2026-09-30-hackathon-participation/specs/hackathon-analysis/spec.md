# Delta for Hackathon Analysis

The General analysis post carries the participation button, and the argument rule accepts `join <slug>`. See `hackathon-participation` for what the button does.

## MODIFIED Requirements

### Requirement: Admin-Only Fresh Analysis, Capped

The system MUST allow only a team admin to run `/hackathon <url>`, in general chat or inside a topic. The command reserves the cap slot and lease, enqueues an analysis job, and immediately acknowledges the request; the page fetch and LLM extraction run asynchronously on a queue consumer. Each such run MUST count against the team's daily cap. The analysis posted in general chat MUST carry an inline "✅ Participamos" button (callback data `hp:<slug>`); the message id of that post MUST be retained so the button can be removed later. Analyses posted inside a topic carry no button.

#### Scenario: Admin runs a fresh analysis in general chat

- GIVEN the caller is a team admin and today's run count is below the cap
- WHEN they run `/hackathon <url>` in the group's general chat
- THEN the system immediately replies "Analizando <host>… el resultado se publicará aquí." and returns
- AND the queue consumer later fetches the page, extracts fields, and stores the analysis under a new slug
- AND posts the analysis and its slug as a separate message, unpinned, with the "✅ Participamos" button

#### Scenario: Analysis run inside a topic has no button

- GIVEN the caller is a team admin
- WHEN they run `/hackathon <url>` inside a forum topic
- THEN the analysis posted in that topic carries no participation button

#### Scenario: Non-admin attempts a fresh analysis

- GIVEN the caller is not a team admin
- WHEN they run `/hackathon <url>`
- THEN the system MUST refuse with "Solo un administrador del equipo puede analizar o vincular un hackathon."
- AND MUST NOT fetch the page, call the LLM, or count against the cap

### Requirement: Argument Classified as Slug or URL

The system MUST classify a bare `/hackathon` argument as a slug when it matches `^[a-z0-9]+(-[a-z0-9]+)*$` and contains neither `.` nor `:`, and as a URL otherwise. The two-token form `join <slug>` MUST be accepted as the participation command and MUST NOT be classified as a slug or URL. A bare `join` with no slug MUST be answered with the join usage line rather than a slug lookup.

#### Scenario: Slug-shaped argument

- WHEN `/hackathon meridian-2` is run
- THEN the system treats `meridian-2` as a slug lookup, not a URL fetch

#### Scenario: URL-shaped argument

- WHEN `/hackathon https://example.com/event` is run
- THEN the system treats it as a URL for fresh analysis

#### Scenario: Join form

- WHEN `/hackathon join meridian-2` is run
- THEN the system treats it as a participation confirmation for `meridian-2`
- AND does not fetch a page or count against the cap

#### Scenario: Bare join shows usage

- WHEN `/hackathon join` is run
- THEN the system replies "Uso: /hackathon join <slug>"
