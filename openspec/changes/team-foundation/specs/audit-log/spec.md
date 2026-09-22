# Audit Log Specification

## Purpose

Records every profile and role change so teams can trace who changed what, keeping sensitive values protected the same way live data is.

## Requirements

### Requirement: Every Profile or Role Change Produces One Audit Row

The system MUST write exactly one audit row per changed field per operation, capturing actor, target, field name, old value, new value, and timestamp, scoped by `team_id`.

#### Scenario: Single field edit

- GIVEN a member changes one profile field
- WHEN the change is applied
- THEN the system inserts one audit row with actor, target, field, old value, new value, and timestamp

#### Scenario: Role change is audited

- GIVEN an admin promotes a member
- WHEN the role change is applied
- THEN the system inserts one audit row with field `role`, old value `member`, new value `admin`

#### Scenario: Rejected edit produces no audit row

- GIVEN an edit attempt is refused (unauthorized actor or cross-tenant target)
- WHEN the refusal occurs
- THEN the system MUST NOT insert an audit row

### Requirement: Audit Values of Encrypted Fields Are Encrypted

When the changed field is a PII field protected by encryption, the system MUST store the audit row's old and new values encrypted with the same versioned scheme, never as plaintext.

#### Scenario: Audit row for encrypted field

- GIVEN a member changes their email
- WHEN the audit row is written
- THEN the old and new email values in the audit row MUST be AES-GCM ciphertext, not plaintext

### Requirement: Audit Read Follows Profile Authorization

The system MUST authorize audit log reads using the same rules as profile reads: same-team members in the data channel, or DM by a registered member of the resolved team.

#### Scenario: Cross-tenant audit read is impossible

- GIVEN a caller belongs only to team A
- WHEN they attempt to read audit rows scoped to team B
- THEN the system MUST refuse or return empty results
