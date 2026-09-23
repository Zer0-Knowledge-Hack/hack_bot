# Telegram Webhook Specification

## Purpose

Validates that inbound Telegram updates are authentic and routes only recognized commands, independent of any team's configuration.

## Requirements

### Requirement: Secret Token Validation

The system MUST reject any webhook POST request whose `X-Telegram-Bot-Api-Secret-Token` header does not exactly match the configured Worker secret.

#### Scenario: Valid secret token

- GIVEN the Worker secret is configured
- WHEN a webhook POST arrives with the matching `X-Telegram-Bot-Api-Secret-Token` header
- THEN the system processes the update

#### Scenario: Missing or wrong secret token

- GIVEN the Worker secret is configured
- WHEN a webhook POST arrives with a missing or mismatched header
- THEN the system MUST reject the request with an error response
- AND MUST NOT process the update

### Requirement: Command-Only Routing

The system MUST route only recognized bot commands (e.g. `/setup`, `/join`, `/datachannel`) to their handlers, under Telegram's default privacy mode where the bot receives commands, replies to its own messages, and service messages.

#### Scenario: Recognized command routed

- GIVEN a validated webhook update
- WHEN the update is a message starting with a recognized command
- THEN the system dispatches it to the matching handler

#### Scenario: Unrecognized update ignored

- GIVEN a validated webhook update
- WHEN the update is not a recognized command and not a reply to the bot
- THEN the system MUST ignore it without error and MUST NOT invoke any handler
