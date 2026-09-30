# Delta for Telegram Webhook

## MODIFIED Requirements

### Requirement: Command-Only Routing

The system MUST route only recognized bot commands (e.g. `/setup`, `/join`, `/datachannel`) and callback queries carrying the `hp:` prefix (participation confirmation) to their handlers, under Telegram's default privacy mode where the bot receives commands, replies to its own messages, service messages, and callback queries. Callback data with any other unrecognized prefix MUST be ignored.

#### Scenario: Recognized command routed

- GIVEN a validated webhook update
- WHEN the update is a message starting with a recognized command
- THEN the system dispatches it to the matching handler

#### Scenario: Participation callback routed

- GIVEN a validated webhook update
- WHEN the update is a callback query whose data starts with `hp:` from a group chat
- THEN the system dispatches it to the participation handler

#### Scenario: Unrecognized update ignored

- GIVEN a validated webhook update
- WHEN the update is not a recognized command, not a recognized callback, and not a reply to the bot
- THEN the system MUST ignore it without error and MUST NOT invoke any handler
