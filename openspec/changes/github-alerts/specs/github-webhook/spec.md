# GitHub Webhook Specification

## Purpose

Verifies that inbound GitHub webhook deliveries are authentic and filters them to the supported event/action set before any org, team, or repo routing happens.

## Requirements

### Requirement: HMAC Signature Verification Over Raw Body

The system MUST verify the `X-Hub-Signature-256` header via HMAC-SHA256 over the raw request body bytes, computed with the global Worker secret `GITHUB_WEBHOOK_SECRET`, using a constant-time comparison, and MUST perform this check before parsing the body as JSON.

#### Scenario: Missing signature header

- GIVEN a webhook POST arrives with no `X-Hub-Signature-256` header
- WHEN the request is received
- THEN the system MUST reject it before parsing the body
- AND MUST NOT process any event

#### Scenario: Wrong signature

- GIVEN a webhook POST arrives with an `X-Hub-Signature-256` header computed from a different secret
- WHEN the signature is verified against the raw body
- THEN the system MUST reject the request before parsing the body

#### Scenario: Right-length but wrong signature

- GIVEN a webhook POST arrives with a signature of the correct hex length but incorrect content
- WHEN the signature is verified using constant-time comparison
- THEN the system MUST reject the request
- AND the rejection MUST NOT leak timing information distinguishing this case from a random wrong-length signature

#### Scenario: Valid signature

- GIVEN a webhook POST arrives with a signature matching the raw body under `GITHUB_WEBHOOK_SECRET`
- WHEN the signature is verified
- THEN the system parses the body and continues processing

### Requirement: Ping Event Acknowledged

The system MUST respond with a 2xx status to a `ping` event, once signature-verified, without further processing.

#### Scenario: GitHub sends a ping

- GIVEN a signature-verified webhook delivery with event type `ping`
- WHEN the request is processed
- THEN the system MUST return a 2xx response
- AND MUST NOT attempt org, repo, or alert routing

### Requirement: Unsupported Event or Action Ignored

The system MUST acknowledge with a 2xx response and drop, without producing an alert, any event/action combination outside the supported set (`pull_request` opened, closed, review_requested; `issues` opened, closed).

#### Scenario: Unsupported event type

- GIVEN a signature-verified webhook delivery with an event type outside the supported set (e.g. `push`)
- WHEN the request is processed
- THEN the system MUST return a 2xx response
- AND MUST NOT produce an alert

#### Scenario: Supported event, unsupported action

- GIVEN a signature-verified `pull_request` event with an action outside the supported set (e.g. `labeled`)
- WHEN the request is processed
- THEN the system MUST return a 2xx response
- AND MUST NOT produce an alert

### Requirement: Infrastructure Failures Return 500

After a valid signature, the system MUST return a 500 response when an unexpected infrastructure failure (e.g. a D1 error) prevents routing, and MUST log it by error name only. This leaves the delivery marked as failed in GitHub so an operator can redeliver it manually. A Telegram delivery failure (e.g. the linked topic was deleted) is NOT an infrastructure failure: it follows the delivery-failure requirement and still returns 2xx, because redelivering cannot fix it.

#### Scenario: D1 is unavailable during routing

- GIVEN a signature-verified supported event
- WHEN reading the org claim or repo link fails with an unexpected error
- THEN the system MUST return a 500 response
- AND MUST log the failure by error name, without the payload
