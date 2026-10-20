## MODIFIED Requirements

### Requirement: Group-Only Eligible Delivery

The system MUST accept natural-language handling only in group or supergroup chats (General and topics). The system MUST NOT run the NL path for private (DM) chats. Under Telegram privacy mode, an eligible NL message MUST be either (a) text or voice that `@`-mentions the bot username from `BOT_INFO`, or (b) a text or voice reply to a message authored by the bot. Other plain-text group messages MUST be ignored without error. When an eligible message is a voice note (`message:voice`), the system MUST transcribe the audio to text via Whisper Speech-to-Text before passing the transcribed text to intent classification. Recognized bot commands MUST continue to use the command handlers and MUST NOT also be classified as NL.

#### Scenario: @mention in General is eligible

- GIVEN a registered team group and the bot username from `BOT_INFO`
- WHEN a member sends a message that `@`-mentions that username followed by `qué hackathons hay` in General
- THEN the system enters the NL path

#### Scenario: Reply to bot in a topic is eligible

- GIVEN a forum topic in a registered team group
- WHEN a member replies to a bot message with `listá los repos`
- THEN the system enters the NL path

#### Scenario: Plain text without mention or reply is ignored

- GIVEN a registered team group
- WHEN a member sends `qué hackathons hay` without mentioning the bot and not as a reply to the bot
- THEN the system ignores the update without invoking the NL classifier

#### Scenario: DM is ignored by NL

- GIVEN a private chat with the bot
- WHEN the user `@`-mentions the bot username from `BOT_INFO` and asks for help
- THEN the system MUST NOT run the NL path

#### Scenario: Commands are not double-handled

- GIVEN a group message `/hackathons`
- WHEN the update is processed
- THEN the existing command handler runs
- AND the NL classifier is NOT called

#### Scenario: Voice note mentioning the bot is transcribed and handled

- GIVEN an eligible voice note in a group chat mentioning the bot or replying to a bot message
- WHEN the update is received
- THEN the system downloads the voice note audio
- AND transcribes it via Whisper STT
- AND passes the transcribed text to the NL classifier

### Requirement: Closed Intent Coverage

The system MUST classify eligible Spanish utterances into a closed intent set that covers every existing group capability: `help`, `setup_team`, `join_team`, `bind_data_channel`, `show_profiles`, `set_profile_field`, `promote_member`, `demote_member`, `link_repo`, `unlink_repo`, `list_repos`, `list_hackathons`, `show_hackathon`, `link_hackathon_topic`, `unlink_hackathon_topic`, `request_hackathon_analysis`, `show_topic_hackathon`, `participate_hackathon`, `capture_feedback`, `list_feedback`, `summarize_feedback`, `archive_feedback`, and `unknown`. Each non-`help`/`unknown` intent MUST dispatch to the same domain use case (or equivalent path) the matching slash command uses today, with the same authorization rules.

#### Scenario: List hackathons via NL

- GIVEN an eligible utterance classified as `list_hackathons` with sufficient confidence
- WHEN the member is a team member
- THEN the system replies with the same listing behavior as `/hackathons`

#### Scenario: Unknown intent

- GIVEN the classifier returns `unknown` or confidence below the design floor (0.55)
- WHEN the utterance is processed
- THEN the system replies with the unknown copy and performs no side effect

#### Scenario: Capture feedback via NL

- GIVEN an eligible utterance describing a bug, issue, or feedback classified as `capture_feedback`
- WHEN the caller is an authenticated team member
- THEN the system records the feedback note in the team inbox

#### Scenario: List feedback via NL

- GIVEN an eligible utterance requesting pending feedback classified as `list_feedback`
- WHEN the caller is an authenticated team member
- THEN the system replies with active feedback notes

#### Scenario: Summarize feedback via NL

- GIVEN an eligible utterance requesting a summary or synthesis of feedback classified as `summarize_feedback`
- WHEN the caller is an authenticated team member
- THEN the system synthesizes pending inbox observations and replies with the briefing

#### Scenario: Archive feedback via NL

- GIVEN an eligible utterance requesting to triage or archive feedback classified as `archive_feedback`
- WHEN the caller is an authenticated team member
- THEN the system updates the status of the target notes to `triaged`
