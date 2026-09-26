# LLM Extraction Specification

## Purpose

Turns a fetched page's reduced text into a strict, nullable-field hackathon record via Workers AI, treating the page text as untrusted input and never guessing a value the page does not state.

## Requirements

### Requirement: Strict Schema Output

The system MUST request extraction against a fixed schema (format, team-size cap, dates, prizes, tracks, name) and MUST validate the model's response against that schema before it reaches the domain layer, rejecting any response that fails validation.

#### Scenario: Well-formed response passes validation

- GIVEN the model returns a response matching the fixed schema
- WHEN the adapter validates it
- THEN the validated fields are passed to the use case

#### Scenario: Malformed response is rejected

- GIVEN the model returns a response that does not match the fixed schema (missing required shape, wrong types, or unparseable output)
- WHEN the adapter validates it
- THEN the system MUST treat this as an extraction failure
- AND MUST NOT pass partial or malformed data to the domain layer

### Requirement: Null Over Guess for Every Field

The system MUST represent a field the page does not clearly state as null rather than an invented value, for every field in the schema.

#### Scenario: Missing field is null, not guessed

- GIVEN the page text contains no team-size information
- WHEN extraction completes
- THEN the team-size field is null
- AND no fabricated value is stored for it

### Requirement: Bounded Source Snippet Per Non-Null Field

For every non-null extracted field, the system MUST store a bounded-length source snippet (at most 200 characters) drawn from the page text, so a human can verify the field.

#### Scenario: Non-null field carries a snippet

- GIVEN the page text states a submission deadline
- WHEN extraction completes
- THEN the deadline field is non-null
- AND a snippet of at most 200 characters supporting that field is stored alongside it

#### Scenario: Null field carries no snippet

- GIVEN a field is null because the page does not state it
- WHEN the analysis is stored
- THEN no source snippet is stored for that field

### Requirement: Page Content Is Framed as Untrusted

The system MUST frame the fetched page text as untrusted data in the extraction request and MUST constrain the model to emit only schema fields, so that instructions embedded in the page text cannot trigger any other action or free-form output.

#### Scenario: Page text contains an embedded instruction

- GIVEN the fetched page text contains text attempting to instruct the model to ignore the schema or perform another action
- WHEN extraction runs
- THEN the system still returns only schema-shaped fields
- AND no free-form or out-of-schema content is produced or stored

### Requirement: Workers AI Schema Failure Is a Distinct, Clear Error

The system MUST report a Workers AI response that fails schema validation as an extraction failure distinct from a fetch failure, with a clear message to the caller, and MUST NOT store a partial analysis.

#### Scenario: Schema validation fails on a fresh analysis

- GIVEN the fetch succeeded but Workers AI's response fails schema validation
- WHEN the queue consumer finishes processing the job
- THEN it posts a message to the originating chat or topic clearly stating the extraction failed
- AND no new or partial row is stored
- AND any previously stored analysis for that slug/URL is unchanged

### Requirement: Workers AI Quota Exhaustion Is Reported and Non-Retrying

The system MUST treat a Workers AI quota-exhaustion response as an extraction failure distinct from a schema failure, MUST report it clearly to the caller, and MUST NOT retry within the same job, including queue retries.

#### Scenario: Workers AI quota is exhausted

- GIVEN the fetch succeeded but the Workers AI call fails due to quota exhaustion
- WHEN the queue consumer finishes processing the job
- THEN it posts a message to the originating chat or topic clearly stating the extraction could not run due to quota exhaustion
- AND the system does not retry within the same job, including queue retries
- AND any previously stored analysis for that slug/URL is unchanged
