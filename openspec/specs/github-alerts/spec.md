# GitHub Alerts Specification

## Purpose

Routes supported GitHub events for linked repos to their linked forum topic as a minimal-field alert message, without storing or logging raw webhook payloads.

## Requirements

### Requirement: Route Alert to the Linked Topic Only

The system MUST deliver an alert only to the forum topic linked to the event's repo for the claiming team. Events for repos with no link, or whose org has no claim, MUST produce no alert.

#### Scenario: Linked repo produces an alert

- GIVEN `owner/repo` is linked to a topic for the claiming team
- WHEN a supported event/action fires for `owner/repo`
- THEN the system sends one alert message to that topic

#### Scenario: Unlinked repo produces no alert

- GIVEN `owner/repo` has no link for any team, or its org is unclaimed
- WHEN a supported event/action fires for `owner/repo`
- THEN the system MUST NOT send any message
- AND MUST NOT fall back to any other channel

### Requirement: Allowlisted Fields Only, No Payload Storage or Logging

The system MUST build the alert message using only repo full name, action, actor login, number, title, and URL, and MUST NOT persist or log the raw webhook payload.

#### Scenario: Alert contains only allowed fields

- GIVEN a supported `pull_request` event for a linked repo
- WHEN the alert message is built
- THEN it contains only repo, action, actor login, number, title, and URL
- AND contains no other payload fields (e.g. no commit emails, no diff content)

#### Scenario: Processing error does not log the payload

- GIVEN an error occurs while handling a webhook event
- WHEN the system logs the error
- THEN the log entry MUST NOT contain the raw request body or any payload field values

### Requirement: Message Truncated to Telegram's Limit

The system MUST truncate the built alert message so it never exceeds Telegram's 4096-character limit before sending.

#### Scenario: Long title is truncated

- GIVEN an issue or PR title long enough that the built message would exceed 4096 characters
- WHEN the alert message is built
- THEN the system truncates it so the final message is at most 4096 characters
- AND the message remains a valid, sendable text

### Requirement: Delivery Failure Is Logged and Acknowledged

The system MUST log a delivery failure (e.g. the linked topic was deleted) by reason only, without the payload, and MUST still return a 2xx response for the webhook request.

#### Scenario: sendMessage fails because the topic was deleted

- GIVEN a repo is linked to a topic that has since been deleted
- WHEN a supported event fires and delivery to that topic fails
- THEN the system logs the failure reason only
- AND the webhook HTTP response is still 2xx
- AND no retry is attempted within the same request
