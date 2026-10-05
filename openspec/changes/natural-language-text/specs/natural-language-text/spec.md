# Natural-Language Text Control Specification

## Purpose

Lets team members drive every existing group bot capability by speaking Spanish in the team group: either `@`-mentioning the bot or replying to a message the bot posted, in General or in a forum topic. The bot maps utterances onto the existing typed use cases and permission gates. Slash commands remain fully supported. Mutations are confirm-first (inline button or affirmative reply). Bot copy is Spanish per `bot-copy`. Voice input and bot audio replies are out of scope.

## Requirements

### Requirement: Group-Only Eligible Delivery

The system MUST accept natural-language handling only in group or supergroup chats (General and topics). The system MUST NOT run the NL path for private (DM) chats. Under Telegram privacy mode, an eligible NL message MUST be either (a) text that `@`-mentions the bot username from `BOT_INFO`, or (b) a reply to a message authored by the bot. Other plain-text group messages MUST be ignored without error. Recognized bot commands MUST continue to use the command handlers and MUST NOT also be classified as NL.

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

### Requirement: Closed Intent Coverage

The system MUST classify eligible Spanish utterances into a closed intent set that covers every existing group capability: `help`, `setup_team`, `join_team`, `bind_data_channel`, `show_profiles`, `set_profile_field`, `promote_member`, `demote_member`, `link_repo`, `unlink_repo`, `list_repos`, `list_hackathons`, `show_hackathon`, `link_hackathon_topic`, `request_hackathon_analysis`, `show_topic_hackathon`, `participate_hackathon`, and `unknown`. Each non-`help`/`unknown` intent MUST dispatch to the same domain use case (or equivalent path) the matching slash command uses today, with the same authorization rules.

#### Scenario: List hackathons via NL

- GIVEN an eligible utterance classified as `list_hackathons` with sufficient confidence
- WHEN the member is a team member
- THEN the system replies with the same listing behavior as `/hackathons`

#### Scenario: Unknown intent

- GIVEN the classifier returns `unknown` or confidence below the design floor (0.55)
- WHEN the utterance is processed
- THEN the system replies with the unknown copy and performs no side effect

### Requirement: Dedicated Help Intent

The system MUST treat `help` as a first-class intent distinct from `unknown`. Help MUST explain how to trigger NL (@mention or reply), give example phrases, and note that slash commands still work.

#### Scenario: Member asks for help

- GIVEN an eligible utterance classified as `help`
- WHEN it is handled
- THEN the system replies with the dedicated help text
- AND creates no confirmation and runs no mutating use case

### Requirement: Reads Execute Immediately

The system MUST execute read intents (`help`, `show_profiles`, `list_repos`, `list_hackathons`, `show_hackathon`, `show_topic_hackathon`) without a confirmation step, after slot resolution and the same membership / data-channel gates the command path uses.

#### Scenario: Show analysis by slug

- GIVEN an eligible utterance classified as `show_hackathon` with slot `slug=meridian`
- WHEN the caller is a team member
- THEN the system shows the analysis as `/hackathon meridian` would for a non-linking context

#### Scenario: Show profiles outside data channel refused

- GIVEN an eligible `show_profiles` utterance in General (not the bound data channel) in a group
- WHEN it is handled
- THEN the system refuses with the existing data-channel-only copy and does not list profiles

### Requirement: Mutations Are Confirm-First

The system MUST NOT execute mutating intents from classification alone. After a complete mutate intent, it MUST post a Spanish confirmation that names the action and non-secret slots, with inline Confirm / Cancel buttons (`nl:` callback family, at most 64 bytes) and a hint that the member may reply affirmatively or cancel in text. The system MUST execute the use case only after a successful confirmation. The confirming actor MUST be the same membership that requested the action.

#### Scenario: Mutate creates confirmation only

- GIVEN an eligible utterance classified as `link_repo` with a complete repo slot inside a topic
- WHEN the caller is a team admin
- THEN the system posts a confirmation message and does NOT yet call `linkRepoToTopic`

#### Scenario: Confirm via button

- GIVEN a pending confirmation for that admin
- WHEN they tap Confirm (`nl:ok:…`)
- THEN the system consumes the confirmation once and runs `linkRepoToTopic`
- AND a second tap does not run it again

#### Scenario: Confirm via affirmative reply

- GIVEN a pending confirmation message
- WHEN the same actor replies to that message with `sí` (or another token in the closed yes lexicon)
- THEN the outcome matches tapping Confirm

#### Scenario: Cancel via reply or button

- GIVEN a pending confirmation
- WHEN the same actor taps Cancel or replies `cancelar` (closed cancel lexicon)
- THEN the confirmation is consumed without running the use case
- AND the system replies that the action was cancelled

#### Scenario: Wrong actor cannot confirm

- GIVEN a pending confirmation created by admin A
- WHEN member B taps Confirm or replies `sí` to that message
- THEN the system refuses and does not execute the use case

#### Scenario: Expired confirmation

- GIVEN a confirmation older than its TTL (10 minutes)
- WHEN someone confirms
- THEN the system replies that there is nothing to confirm and executes nothing

#### Scenario: Concurrent button and reply confirm once

- GIVEN a pending confirmation
- WHEN the same actor taps Confirm and nearly simultaneously replies with an affirmative lexicon token
- THEN the use case runs at most once
- AND the losing path is a busy/noop after CAS consume

### Requirement: Role-Change Target Resolution

For `promote_member` and `demote_member`, the system MUST resolve the target membership from an explicit membership id in the utterance **or** from a reply-to-user message that identifies a team member. If neither yields exactly one membership, the system MUST ask a clarifying question and MUST NOT create a confirmation or guess.

#### Scenario: Promote with explicit membership id

- GIVEN an eligible admin utterance classified as `promote_member` with a valid `membershipId` slot
- WHEN slots are complete
- THEN the system posts a confirmation naming that membership (no side effect yet)

#### Scenario: Promote via reply-to-user

- GIVEN an eligible admin utterance classified as `promote_member` that is a reply to a message from a team member, with no membership id in the text
- WHEN slots are resolved
- THEN the target is that member's membership in this team
- AND a confirmation is posted

#### Scenario: Ambiguous promote asks to clarify

- GIVEN an eligible admin utterance classified as `promote_member` with no membership id and not a reply-to-user (or the replied user is not a team member)
- WHEN it is handled
- THEN the system asks a clarifying question
- AND creates no confirmation

### Requirement: Profile Field Updates Only in the Data Channel

For `set_profile_field`, the system MUST accept NL only when the utterance is sent inside the team's bound data-channel topic. Elsewhere it MUST refuse without creating a confirmation. Confirmation and success copy MUST NOT echo the profile field value.

#### Scenario: Profile set in General refused

- GIVEN an eligible utterance asking to set a profile field in General
- WHEN it is handled
- THEN the system replies directing the member to the data channel
- AND creates no confirmation

#### Scenario: Profile set in data channel confirms without echoing value

- GIVEN the utterance is in the bound data channel and classified as `set_profile_field`
- WHEN a confirmation is posted
- THEN the confirmation names the field but MUST NOT include the new value

### Requirement: Participate Maps to Existing Use Case

After NL confirmation of `participate_hackathon`, the system MUST call `participateInHackathon` directly (same effects as `/hackathon join <slug>` / the `hp:` button path). It MUST NOT require a second `hp:` confirmation for that utterance.

#### Scenario: NL participate after confirm

- GIVEN a confirmed `participate_hackathon` with slug `meridian` from a team admin
- WHEN confirmation succeeds
- THEN `participateInHackathon` runs once with that slug

### Requirement: Classifier Configuration and Quota

The system MUST call Workers AI only with the dedicated `NL_MODEL_PRIMARY` configuration. If that var is missing or blank, the NL path MUST fail closed with a Spanish not-configured reply and MUST NOT break slash commands. The system MUST enforce a per-team soft daily classification quota (100 classify calls per UTC day) before calling the model, separate from the hackathon analysis quota. Prefilter rejections and affirmative/cancel replies to pending confirmations MUST NOT consume a classify quota slot.

#### Scenario: Missing model fails NL only

- GIVEN `NL_MODEL_PRIMARY` is unset
- WHEN an eligible NL utterance arrives
- THEN the system replies that NL is not configured
- AND `/hackathons` still works

#### Scenario: Daily NL quota exhausted

- GIVEN the team has already used 100 NL classifications today (UTC)
- WHEN another eligible utterance would classify
- THEN the system replies with the NL quota copy and does not call the model

#### Scenario: Affirmative reply does not classify

- GIVEN a pending confirmation
- WHEN the actor replies `sí`
- THEN no IntentClassifier call is made

### Requirement: Privacy of Logs and Slots

The system MUST NOT write full user utterances, profile field values, or raw model content to application logs. Logs MAY include intent id, confidence bucket, outcome codes, and non-secret error codes. Pending confirmations MAY store `profileValue` in D1 `slots_json` as short-lived plaintext with a maximum TTL of 10 minutes; that value MUST still never appear in confirmation copy, success replies, or logs, and MUST be removed or marked consumed as soon as the confirmation settles (yes, cancel, or expiry).

#### Scenario: Classify failure logs safely

- GIVEN the classifier fails
- WHEN the failure is logged
- THEN the log entry does not contain the user text or profile values

#### Scenario: Profile value not retained past confirmation lifecycle

- GIVEN a `set_profile_field` confirmation that stored a profile value in `slots_json`
- WHEN the confirmation is consumed, cancelled, or expires
- THEN the pending row is no longer usable for a later confirm
- AND no log line contains the profile value

### Requirement: Spanish-First with Extension Hooks

User-facing NL copy and the classifier prompt MUST be Spanish for this change. The intent schema and ports MUST allow adding English and Portuguese later without redesigning the closed intent set. Shipping en/pt UX is out of scope.

#### Scenario: Help copy is Spanish

- GIVEN a `help` reply
- THEN the text is Spanish and matches the bot-copy language rules
