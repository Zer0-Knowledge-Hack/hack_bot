# Hackathon Analysis Specification

## Purpose

Lets a team analyze a hackathon event page from the general chat via a short slug, and optionally link and pin that analysis to a forum topic once the team decides to join.

## Requirements

### Requirement: Admin-Only Fresh Analysis, Capped

The system MUST allow only a team admin to run `/hackathon <url>`, in general chat or inside a topic. The command reserves the cap slot and lease, enqueues an analysis job, and immediately acknowledges the request; the page fetch and LLM extraction run asynchronously on a queue consumer. Each such run MUST count against the team's daily cap.

#### Scenario: Admin runs a fresh analysis in general chat

- GIVEN the caller is a team admin and today's run count is below the cap
- WHEN they run `/hackathon <url>` in the group's general chat
- THEN the system immediately replies "Analyzing <host>…" and returns
- AND the queue consumer later fetches the page, extracts fields, and stores the analysis under a new slug
- AND posts the analysis and its slug as a separate message, unpinned

#### Scenario: Non-admin attempts a fresh analysis

- GIVEN the caller is not a team admin
- WHEN they run `/hackathon <url>`
- THEN the system MUST refuse
- AND MUST NOT fetch the page, call the LLM, or count against the cap

### Requirement: Any Member Re-Shows by Slug, Free of Cap

The system MUST let any registered member run `/hackathon <slug>` to re-show a previously stored analysis without counting against the daily cap. When an admin runs it inside a topic, the system MUST also link and pin the analysis to that topic.

#### Scenario: Member re-shows an existing slug

- GIVEN a stored analysis exists under `<slug>` for the team
- WHEN any registered member runs `/hackathon <slug>`
- THEN the system replies with the stored analysis
- AND does not increment the daily cap counter

#### Scenario: Admin re-shows by slug inside a topic

- GIVEN a stored analysis exists under `<slug>`
- WHEN a team admin runs `/hackathon <slug>` inside a forum topic
- THEN the system links that analysis to the topic and pins the reply

### Requirement: No-Argument Behavior Depends on Topic Linking

The system MUST show the linked topic's cached analysis when `/hackathon` is run with no argument inside a topic that already has one, and MUST reply with usage instructions otherwise.

#### Scenario: No-argument inside a linked topic

- GIVEN the current topic already has a linked analysis
- WHEN a member runs `/hackathon` with no argument
- THEN the system replies with the linked analysis

#### Scenario: No-argument with nothing linked

- GIVEN the current topic (or general chat) has no linked analysis
- WHEN a member runs `/hackathon` with no argument
- THEN the system replies with usage instructions
- AND does not fetch, extract, or count against the cap

### Requirement: Argument Classified as Slug or URL

The system MUST classify a bare `/hackathon` argument as a slug when it matches `^[a-z0-9]+(-[a-z0-9]+)*$` and contains neither `.` nor `:`, and as a URL otherwise.

#### Scenario: Slug-shaped argument

- WHEN `/hackathon meridian-2` is run
- THEN the system treats `meridian-2` as a slug lookup, not a URL fetch

#### Scenario: URL-shaped argument

- WHEN `/hackathon https://example.com/event` is run
- THEN the system treats it as a URL for fresh analysis

### Requirement: Slug Generation and Uniqueness

The system MUST derive the slug from the extracted hackathon name, falling back to the URL host when no name is available, and MUST append a numeric suffix (`-2`, `-3`, ...) when the derived slug already exists for the team.

#### Scenario: First analysis gets the base slug

- GIVEN no analysis named `meridian` exists for the team
- WHEN a fresh analysis extracts the name "Meridian"
- THEN the system stores it as `meridian`

#### Scenario: Collision appends a numeric suffix

- GIVEN `meridian` already exists for the team
- WHEN another fresh analysis also derives the slug `meridian`
- THEN the system stores the new one as `meridian-2`

### Requirement: Same-URL Refresh Keeps the Slug

The system MUST treat a fresh analysis of the same normalized URL, for the same team, as a refresh of the existing row, keeping its slug rather than creating a new one.

#### Scenario: Re-running the same URL refreshes in place

- GIVEN an analysis for `https://example.com/event` already exists under slug `meridian`
- WHEN an admin runs `/hackathon https://example.com/event` again
- THEN the system updates the existing `meridian` row instead of creating a second one

#### Scenario: Failed re-analysis keeps the prior result

- GIVEN an analysis already exists under a slug
- WHEN a fresh run for the same URL fails (fetch or extraction failure)
- THEN the system MUST keep the previously stored analysis unchanged
- AND the queue consumer MUST post a clear failure message to the originating chat or topic

### Requirement: One Analysis Per Topic, Conflicts Move the Link

The system MUST allow at most one linked analysis per topic (nullable `thread_id`). Linking a second analysis to an already-linked topic, or linking an analysis already linked elsewhere, MUST move the link, unpin the previous pinned message, and state this in the reply.

#### Scenario: Linking into an empty topic

- GIVEN the topic has no linked analysis
- WHEN an admin runs `/hackathon <slug>` inside that topic
- THEN the system links and pins the analysis to the topic

#### Scenario: Topic already holds a different analysis

- GIVEN topic A is linked to analysis `alpha`
- WHEN an admin runs `/hackathon beta` inside topic A
- THEN the system unpins the old pinned message for `alpha`
- AND links and pins `beta` to topic A
- AND the reply states the topic's previous link was replaced

#### Scenario: Analysis already linked to another topic

- GIVEN analysis `alpha` is linked to topic A
- WHEN an admin runs `/hackathon alpha` inside topic B
- THEN the system unpins the old pinned message in topic A
- AND links and pins `alpha` to topic B
- AND the reply states the analysis moved from topic A to topic B

### Requirement: Pin Failure Falls Back to Unpinned Posting

The system MUST still post the analysis when the bot lacks the "can pin messages" right, and MUST clearly state in the reply that pinning failed.

#### Scenario: Bot lacks pin rights

- GIVEN the bot does not have "can pin messages" in the chat
- WHEN an admin runs `/hackathon <slug>` inside a topic
- THEN the system posts the analysis unpinned
- AND the reply states that pinning failed

### Requirement: Daily Cap on Fresh Runs

The system MUST enforce a per-team daily cap of 5 fetch+LLM runs per UTC day, counting only fresh `/hackathon <url>` runs. The system MUST reserve the cap slot at enqueue time, atomically with the team lease, before the job runs. The system MUST refund the reserved slot only when enqueuing the job fails or the queued job expires unclaimed; a job that starts running MUST NOT be refunded regardless of its outcome. Re-shows by slug MUST NOT count.

#### Scenario: Cap reached

- GIVEN the team has already run 5 fresh analyses in the current UTC day
- WHEN an admin runs `/hackathon <url>` again
- THEN the system MUST refuse with a clear cap-exceeded message
- AND MUST NOT reserve a slot, fetch the page, or call the LLM

### Requirement: Fresh Analysis Job Safety Under Concurrency and Delivery Faults

The system MUST refuse a second fresh analysis request for a team while one is already queued or running, without consuming a cap slot. The system MUST refuse cleanly and consume no cap slot when enqueuing the job itself fails. The system MUST guarantee that a job delivered more than once produces no second cap count, no second LLM call, and no second posted result. The system MUST post a failure reply and preserve any previously stored analysis when a job exhausts its retries.

#### Scenario: Analysis already running

- GIVEN a fresh analysis job for the team is already queued or running
- WHEN the same team runs `/hackathon <url>` again
- THEN the system MUST refuse with a clear "already running" reply
- AND MUST NOT consume a cap slot

#### Scenario: Enqueue failure

- GIVEN the cap slot and lease were reserved but enqueuing the job fails
- WHEN `/hackathon <url>` is run
- THEN the system MUST reply with a clear "could not start" message
- AND MUST refund the reserved slot so it is not counted against the daily cap

#### Scenario: Duplicate delivery

- GIVEN a job has already reached a persisted or terminal state
- WHEN the queue delivers that same job a second time
- THEN the system MUST NOT count it again against the cap
- AND MUST NOT call the LLM again
- AND MUST NOT post the result a second time

#### Scenario: Transient failure exhausts retries

- GIVEN a job fails with a transient error on every attempt up to the retry limit
- WHEN the final attempt also fails
- THEN the system MUST post a clear failure reply to the originating chat or topic
- AND MUST keep any previously stored analysis unchanged

### Requirement: Listing Is Read-Only and Truncated

The system MUST let any registered member run `/hackathons` to list slug, name, key deadline, and linked-topic status for all the team's stored analyses, truncated to at most 4096 characters using the same pattern as `/repos`.

#### Scenario: Listing within the limit

- GIVEN the team has several stored analyses
- WHEN a member runs `/hackathons`
- THEN the reply lists each analysis's slug, name, key deadline, and linked status
- AND the reply is at most 4096 characters

#### Scenario: Listing exceeds the limit

- GIVEN the team has enough stored analyses that the full listing would exceed 4096 characters
- WHEN a member runs `/hackathons`
- THEN the system truncates the reply and appends an "...and N more" note
- AND the reply remains at most 4096 characters

### Requirement: Plain Text Replies

The system MUST send all `/hackathon` and `/hackathons` replies as plain text (no `parse_mode`), at most 4096 characters, whether sent as an immediate synchronous reply or posted later by the queue consumer.
