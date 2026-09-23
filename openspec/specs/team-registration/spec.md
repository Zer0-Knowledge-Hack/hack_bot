# Team Registration Specification

## Purpose

Creates a team (tenant) from a Telegram group and establishes the bootstrap admin and the team's data channel.

## Requirements

### Requirement: Setup Creates Team and First Admin

The system MUST create a team when `/setup` is run inside a Telegram group that has no existing team, and MUST assign the caller as the first admin membership.

#### Scenario: Successful setup

- GIVEN a Telegram group with no registered team
- WHEN a Telegram group admin runs `/setup`
- THEN the system creates a team bound to the group's `chat_id`
- AND creates a membership for the caller with role `admin`

#### Scenario: Setup rejected when team already exists

- GIVEN a Telegram group already bound to a team
- WHEN any user runs `/setup` again in that group
- THEN the system MUST refuse and reply that the team already exists

### Requirement: Setup Requires Verified Group Admin

The system MUST verify the caller's Telegram group-admin status via `getChatMember` before creating a team, and MUST refuse creation if the check fails for any reason.

#### Scenario: getChatMember call fails

- GIVEN `/setup` is invoked in a group
- WHEN the `getChatMember` API call errors or times out
- THEN the system MUST NOT create the team
- AND MUST reply with a retryable error message

#### Scenario: Caller is not a group admin

- GIVEN `/setup` is invoked in a group
- WHEN `getChatMember` returns a non-admin, non-owner status for the caller
- THEN the system MUST refuse to create the team
- AND MUST NOT create any membership

### Requirement: Data Channel Binding via /datachannel

The system MUST allow a team admin to designate a forum Topic of the team's group as the team's data channel by running `/datachannel` inside that topic. The data channel defaults to unset until bound.

#### Scenario: Admin binds the data channel

- GIVEN a team exists and its group has forum Topics enabled
- WHEN a team admin runs `/datachannel` inside a specific topic
- THEN the system stores that topic's `message_thread_id` as the team's data channel

#### Scenario: Non-admin attempts to bind data channel

- GIVEN a team exists
- WHEN a non-admin member runs `/datachannel` inside any topic
- THEN the system MUST refuse and MUST NOT change the stored data channel

#### Scenario: /datachannel run outside a topic

- GIVEN a team exists
- WHEN an admin runs `/datachannel` in the group's general chat (not inside a topic)
- THEN the system MUST refuse and instruct the admin to run it inside the intended topic
