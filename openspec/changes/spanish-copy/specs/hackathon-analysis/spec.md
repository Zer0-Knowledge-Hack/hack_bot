# Delta for Hackathon Analysis

Only requirements whose scenarios quote bot copy are modified. Copy is the exact Spanish text below; see `bot-copy` for cross-cutting rules.

## MODIFIED Requirements

### Requirement: Admin-Only Fresh Analysis, Capped

The system MUST allow only a team admin to run `/hackathon <url>`, in general chat or inside a topic. The command reserves the cap slot and lease, enqueues an analysis job, and immediately acknowledges the request; the page fetch and LLM extraction run asynchronously on a queue consumer. Each such run MUST count against the team's daily cap.
(Previously: acknowledgement quoted as English "Analyzing <host>…"; refusal unquoted)

#### Scenario: Admin runs a fresh analysis in general chat

- GIVEN the caller is a team admin and today's run count is below the cap
- WHEN they run `/hackathon <url>` in the group's general chat
- THEN the system immediately replies "Analizando <host>… el resultado se publicará aquí." and returns
- AND the queue consumer later fetches the page, extracts fields, and stores the analysis under a new slug
- AND posts the analysis and its slug as a separate message, unpinned

#### Scenario: Non-admin attempts a fresh analysis

- GIVEN the caller is not a team admin
- WHEN they run `/hackathon <url>`
- THEN the system MUST refuse with "Solo un administrador del equipo puede analizar o vincular un hackathon."
- AND MUST NOT fetch the page, call the LLM, or count against the cap

### Requirement: No-Argument Behavior Depends on Topic Linking

The system MUST show the linked topic's cached analysis when `/hackathon` is run with no argument inside a topic that already has one, and MUST reply with usage instructions otherwise.
(Previously: usage reply was unquoted English)

#### Scenario: No-argument inside a linked topic

- GIVEN the current topic already has a linked analysis
- WHEN a member runs `/hackathon` with no argument
- THEN the system replies with the linked analysis

#### Scenario: No-argument with nothing linked

- GIVEN the current topic (or general chat) has no linked analysis
- WHEN a member runs `/hackathon` with no argument
- THEN the system replies "Uso: /hackathon <url o slug>"
- AND does not fetch, extract, or count against the cap

### Requirement: One Analysis Per Topic, Conflicts Move the Link

The system MUST allow at most one linked analysis per topic (nullable `thread_id`). Linking a second analysis to an already-linked topic, or linking an analysis already linked elsewhere, MUST move the link, unpin the previous pinned message, and state this in the reply.
(Previously: link notes were English)

#### Scenario: Linking into an empty topic

- GIVEN the topic has no linked analysis
- WHEN an admin runs `/hackathon <slug>` inside that topic
- THEN the system links and pins the analysis to the topic
- AND a link-only reply reads "Se vinculó <slug> a este tema."

#### Scenario: Topic already holds a different analysis

- GIVEN topic A is linked to analysis `alpha`
- WHEN an admin runs `/hackathon beta` inside topic A
- THEN the system unpins the old pinned message for `alpha`
- AND links and pins `beta` to topic A
- AND the reply states "Se reemplazó el vínculo anterior del tema (era alpha)."

#### Scenario: Analysis already linked to another topic

- GIVEN analysis `alpha` is linked to topic A
- WHEN an admin runs `/hackathon alpha` inside topic B
- THEN the system unpins the old pinned message in topic A
- AND links and pins `alpha` to topic B
- AND the reply states "Se movió el vínculo de este análisis desde otro tema."

### Requirement: Pin Failure Falls Back to Unpinned Posting

The system MUST still post the analysis when the bot lacks the "can pin messages" right, and MUST clearly state in the reply that pinning failed.
(Previously: pin-failure note was English)

#### Scenario: Bot lacks pin rights

- GIVEN the bot does not have "can pin messages" in the chat
- WHEN an admin runs `/hackathon <slug>` inside a topic
- THEN the system posts the analysis unpinned
- AND the reply states "No se pudo fijar el mensaje; se publicó sin fijar."

### Requirement: Daily Cap on Fresh Runs

The system MUST enforce a per-team daily cap of 5 fetch+LLM runs per UTC day, counting only fresh `/hackathon <url>` runs. The system MUST reserve the cap slot at enqueue time, atomically with the team lease, before the job runs. The system MUST refund the reserved slot only when enqueuing the job fails or the queued job expires unclaimed; a job that starts running MUST NOT be refunded regardless of its outcome. Re-shows by slug MUST NOT count.
(Previously: cap-exceeded refusal was an unquoted English "clear message")

#### Scenario: Cap reached

- GIVEN the team has already run 5 fresh analyses in the current UTC day
- WHEN an admin runs `/hackathon <url>` again
- THEN the system MUST refuse with "Límite diario alcanzado (5 análisis nuevos por día UTC). Volver a mostrar un slug no cuenta."
- AND MUST NOT reserve a slot, fetch the page, or call the LLM

### Requirement: Fresh Analysis Job Safety Under Concurrency and Delivery Faults

The system MUST refuse a second fresh analysis request for a team while one is already queued or running, without consuming a cap slot. The system MUST refuse cleanly and consume no cap slot when enqueuing the job itself fails. The system MUST guarantee that a job redelivered after reaching a terminal state produces no second cap count, no second LLM call, and no second posted result. The system MUST post a failure reply and preserve any previously stored analysis when a job exhausts its retries.
(Previously: "already running" and "could not start" replies quoted in English)

#### Scenario: Analysis already running

- GIVEN a fresh analysis job for the team is already queued or running
- WHEN the same team runs `/hackathon <url>` again
- THEN the system MUST refuse with "Ya hay un análisis en curso para este equipo. Espera su resultado."
- AND MUST NOT consume a cap slot

#### Scenario: Enqueue failure

- GIVEN the cap slot and lease were reserved but enqueuing the job fails
- WHEN `/hackathon <url>` is run
- THEN the system MUST reply "No se pudo iniciar el análisis; inténtalo de nuevo en un minuto. No se contó en el límite diario."
- AND MUST refund the reserved slot so it is not counted against the daily cap

#### Scenario: Duplicate delivery

- GIVEN a job has already reached a terminal state (succeeded or failed)
- WHEN the queue delivers that same job again
- THEN the system MUST ack it with no second cap count, no LLM call, and no post
- AND a job redelivered while still `persisted` MUST skip the fetch and the LLM call and only post the stored result again
- AND the design accepts that a crash between posting and marking the job succeeded can cause that post to repeat once (design.md "Post then mark")

#### Scenario: Transient failure exhausts retries

- GIVEN a job fails with a transient error on every attempt up to the retry limit
- WHEN the final attempt also fails
- THEN the system MUST post "El análisis falló por un error temporal. Inténtalo de nuevo más tarde." to the originating chat or topic
- AND MUST keep any previously stored analysis unchanged

#### Scenario: Fetch failure keeps the prior result

- GIVEN a fresh run fails to read the page with fetch kind `timeout`
- WHEN the consumer posts the failure
- THEN the reply is "No se pudo leer esa página (tiempo de espera agotado). Se conservó el análisis anterior."

### Requirement: Listing Is Read-Only and Truncated

The system MUST let any registered member run `/hackathons` to list slug, name, key deadline, and linked-topic status for all the team's stored analyses, truncated to at most 4096 characters using the same pattern as `/repos`.
(Previously: truncation note quoted as English "...and N more")

#### Scenario: Listing within the limit

- GIVEN the team has several stored analyses
- WHEN a member runs `/hackathons`
- THEN the reply lists each analysis's slug, name, key deadline, and linked status with Spanish labels
- AND the reply is at most 4096 characters

#### Scenario: Listing exceeds the limit

- GIVEN the team has enough stored analyses that the full listing would exceed 4096 characters
- WHEN a member runs `/hackathons`
- THEN the system truncates the reply and appends a "…y N más" line
- AND the reply remains at most 4096 characters

### Requirement: Same-URL Refresh Keeps the Slug

The system MUST treat a fresh analysis of the same normalized URL, for the same team, as a refresh of the existing row, keeping its slug rather than creating a new one.
(Previously: failure message was an unquoted English "clear failure message")

#### Scenario: Re-running the same URL refreshes in place

- GIVEN an analysis for `https://example.com/event` already exists under slug `meridian`
- WHEN an admin runs `/hackathon https://example.com/event` again
- THEN the system updates the existing `meridian` row instead of creating a second one

#### Scenario: Failed re-analysis keeps the prior result

- GIVEN an analysis already exists under a slug
- WHEN a fresh run for the same URL fails (fetch or extraction failure)
- THEN the system MUST keep the previously stored analysis unchanged
- AND the queue consumer MUST post a Spanish failure message to the originating chat or topic, for example "La página tiene muy poco texto legible. Se conservó el análisis anterior."
