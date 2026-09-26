# Page Fetch Specification

## Purpose

Safely retrieves an event page's visible text for analysis, guarding against SSRF, oversized or slow responses, and falling back to browser rendering for JS-heavy pages, without persisting or logging the raw page.

## Requirements

### Requirement: Scheme and Destination Guard on the Static Path

The system MUST allow only `http` and `https` URLs, and MUST refuse a fetch whose hostname or resolved literal is `localhost`, a loopback, RFC1918, link-local, or ULA address, or the `169.254.169.254` metadata address.

#### Scenario: Disallowed scheme

- WHEN a fresh analysis is requested for `file:///etc/passwd`
- THEN the system MUST refuse before attempting any fetch

#### Scenario: Loopback or private host

- WHEN a fresh analysis is requested for a URL whose host resolves to `127.0.0.1`, `10.0.0.5`, or `169.254.169.254`
- THEN the system MUST refuse the fetch
- AND MUST NOT attempt the browser fallback for that same URL

### Requirement: Same Guard Applies to the Browser Fallback

The system MUST apply the identical scheme and destination guard to the Browser Rendering path, and MUST refuse before invoking the browser adapter for a disallowed target, including a redirect encountered during browser rendering.

#### Scenario: Browser path refuses an unsafe target

- GIVEN static fetch already triggered the browser fallback
- WHEN the resolved target for browser rendering is a private or loopback address
- THEN the system MUST refuse without rendering the page

#### Scenario: Browser rendering redirect to an unsafe target

- GIVEN a page is being rendered by the browser fallback
- WHEN that page redirects to a private, loopback, or metadata address
- THEN the system MUST abort and refuse rather than follow the redirect

### Requirement: Size and Time Caps on Static Fetch

The system MUST cap the bytes read from a static fetch to a bounded limit (about 2 MB) and the wall-clock time to a bounded limit (about 10 s), aborting and treating either as a fetch failure.

#### Scenario: Response exceeds the size cap

- GIVEN a page response exceeds the byte cap while streaming
- WHEN the fetch is in progress
- THEN the system aborts the fetch and reports a fetch failure

#### Scenario: Fetch exceeds the time cap

- GIVEN a page response has not completed before the time cap elapses
- WHEN the timeout fires
- THEN the system aborts the fetch and reports a fetch failure

### Requirement: Browser Rendering Fallback on Thin Static Text

The system MUST fall back to Browser Rendering when the visible text produced by the static fetch falls below a length heuristic, and MUST use that page's rendered text for extraction when the fallback succeeds.

#### Scenario: Thin static text triggers the fallback

- GIVEN the static fetch's reduced visible text is below the length heuristic
- WHEN the analysis proceeds
- THEN the system invokes Browser Rendering for the same URL
- AND uses the rendered text if the fallback succeeds

#### Scenario: Sufficient static text skips the fallback

- GIVEN the static fetch's reduced visible text meets the length heuristic
- WHEN the analysis proceeds
- THEN the system does not invoke Browser Rendering

### Requirement: Browser Rendering Quota Exhaustion Degrades or Fails Based on Static Text Length

When Browser Rendering responds with a quota-exhausted status (HTTP 429), the system MUST fall back to using the static fetch's text for extraction when that text has at least 200 characters, and MUST treat the exhaustion as a fetch failure distinct from a generic fetch error only when the static text has fewer than 200 characters. The system MUST NOT retry Browser Rendering within the same analysis job, including queue retries.

#### Scenario: Browser Rendering returns 429 with usable static text

- GIVEN the static fetch produced at least 200 characters of text before the browser fallback was triggered
- WHEN Browser Rendering responds with a quota-exhausted status (429)
- THEN the system uses the static text for extraction instead of failing
- AND does not retry Browser Rendering within the same analysis job, including queue retries

#### Scenario: Browser Rendering returns 429 with insufficient static text

- GIVEN the static fetch produced fewer than 200 characters of text before the browser fallback was triggered
- WHEN Browser Rendering responds with a quota-exhausted status (429)
- THEN the system reports a fetch failure attributable to quota exhaustion
- AND does not retry within the same analysis job, including queue retries
- AND keeps any previously stored analysis unchanged

### Requirement: No Raw Page Stored or Logged

The system MUST NOT persist the fetched HTML or full extracted text in any datastore, and MUST NOT include the raw page body in any log entry, on either the static or the browser path.

#### Scenario: Successful analysis stores only bounded output

- GIVEN a page is fetched and analyzed successfully
- WHEN the result is persisted
- THEN only the extracted fields and bounded source snippets are stored
- AND no raw HTML or full page text is written to any table

#### Scenario: A fetch error is logged safely

- GIVEN a fetch fails for any reason (SSRF refusal, size cap, time cap, quota)
- WHEN the failure is logged
- THEN the log entry MUST NOT contain the page body or response content
- AND MUST contain only the failure reason and non-sensitive identifiers
