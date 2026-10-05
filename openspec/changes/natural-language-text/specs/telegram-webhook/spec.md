# Delta for Telegram Webhook

## MODIFIED Requirements

### Requirement: Command-Only Routing

The system MUST route recognized bot commands, recognized callback queries, and eligible natural-language group messages to their handlers. Recognized callbacks are those whose data starts with `hp:` (participation) or `nl:` (natural-language confirmation). Eligible NL messages are group/supergroup texts that `@`-mention the bot or reply to a bot-authored message, as specified by `natural-language-text`. Private-chat plain text MUST NOT enter the NL path. Callback data with any other unrecognized prefix MUST be ignored. Non-eligible plain-text group messages MUST be ignored without error. Under Telegram's default privacy mode the bot receives commands, replies to its own messages, service messages, @mentions of the bot, and callback queries; this change MUST NOT require disabling privacy mode.

#### Scenario: Recognized command routed

- GIVEN a validated webhook update
- WHEN the update is a message starting with a recognized command
- THEN the system dispatches it to the matching handler

#### Scenario: Participation callback routed

- GIVEN a validated webhook update
- WHEN the update is a callback query whose data starts with `hp:` from a group chat
- THEN the system dispatches it to the participation handler

#### Scenario: NL confirmation callback routed

- GIVEN a validated webhook update
- WHEN the update is a callback query whose data starts with `nl:` from a group chat
- THEN the system dispatches it to the NL confirmation handler

#### Scenario: Eligible NL mention routed

- GIVEN a validated webhook update from a group
- WHEN the message text @-mentions the bot and is not a bot command
- THEN the system dispatches it to the NL handler

#### Scenario: Eligible NL reply-to-bot routed

- GIVEN a validated webhook update from a group or topic
- WHEN the message is a reply to a bot-authored message and is not a bot command
- THEN the system dispatches it to the NL handler
- AND if it is an affirmative or cancel reply to a pending NL confirmation, the confirmation resolver runs without classification

#### Scenario: Unrecognized update ignored

- GIVEN a validated webhook update
- WHEN the update is not a recognized command, not a recognized callback (`hp:` / `nl:`), and not an eligible NL message
- THEN the system MUST ignore it without error and MUST NOT invoke any handler

#### Scenario: DM plain text not treated as NL

- GIVEN a validated webhook update from a private chat
- WHEN the text @-mentions the bot or replies to the bot
- THEN the system MUST NOT dispatch it to the NL handler
