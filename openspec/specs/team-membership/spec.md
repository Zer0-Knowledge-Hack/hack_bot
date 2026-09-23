# Team Membership Specification

## Purpose

Manages who belongs to a team, their role, and which team a DM-based command applies to. Guarantees strict tenant isolation.

## Requirements

### Requirement: Join Command Creates Membership

The system MUST create a membership with role `member` when `/join` is run inside a team's group by a user with no existing membership in that team. The bot-stored role is authoritative after creation.

#### Scenario: New user joins a team

- GIVEN a team exists for the current group
- WHEN a user with no membership in this team runs `/join`
- THEN the system creates a membership with role `member`

#### Scenario: Already-a-member re-runs /join

- GIVEN the caller already has a membership in this team
- WHEN they run `/join` again
- THEN the system MUST NOT create a duplicate membership
- AND MUST reply that they are already a member

### Requirement: Admin Promote and Demote

The system MUST allow only an existing team admin to promote a member to `admin` or demote an admin to `member`, and MUST audit every role change.

#### Scenario: Admin promotes a member

- GIVEN the caller is an admin of the team
- WHEN they run a promote command targeting a member of the same team
- THEN the system sets the target's role to `admin`
- AND records an audit row for the role change

#### Scenario: Non-admin attempts promote/demote

- GIVEN the caller is a member (not admin) of the team
- WHEN they run a promote or demote command
- THEN the system MUST refuse and MUST NOT change any role

### Requirement: DM Team Resolution With No Implicit Default

In a direct message, the system MUST resolve which team a member-data command applies to based on the caller's memberships, and MUST NOT silently default to a previously used team.

#### Scenario: Caller has zero teams

- GIVEN the caller has no memberships
- WHEN they send a member-data command in DM
- THEN the system MUST reply instructing them to run `/join` in a team group

#### Scenario: Caller has exactly one team

- GIVEN the caller has exactly one membership
- WHEN they send a member-data command in DM
- THEN the system MUST operate on that team without prompting

#### Scenario: Caller has two or more teams

- GIVEN the caller has memberships in two or more teams
- WHEN they send a member-data command in DM
- THEN the system MUST present an explicit team picker
- AND MUST NOT proceed until the caller selects one team

#### Scenario: Explicit selection is remembered for 15 minutes

- GIVEN a caller with two or more teams explicitly selected team A in the DM picker less than 15 minutes ago
- WHEN they send another member-data command in DM
- THEN the system MUST re-verify the caller's membership in team A before operating
- AND MUST operate on team A without prompting
- AND MUST state in the reply which team the response applies to

#### Scenario: Selection expires or membership is lost

- GIVEN a caller's DM team selection is older than 15 minutes, or the caller is no longer a member of the selected team
- WHEN they send a member-data command in DM
- THEN the system MUST discard the selection and present the team picker again

### Requirement: Tenant Isolation Enforced at Data Layer

Every membership, profile, and audit query MUST be scoped by `team_id`. The system MUST NOT return or accept data across teams under any code path.

#### Scenario: Cross-tenant read is impossible

- GIVEN a member belongs only to team A
- WHEN they attempt to read profile data scoped to team B (via DM team-id spoofing or any command parameter)
- THEN the system MUST refuse or return empty results
- AND MUST NOT expose any team B member data

#### Scenario: Cross-tenant write is impossible

- GIVEN a caller is an admin of team A only
- WHEN they attempt a promote/demote or profile edit targeting a member of team B
- THEN the system MUST refuse the operation
- AND MUST NOT modify any team B row
