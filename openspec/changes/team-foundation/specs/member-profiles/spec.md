# Member Profiles Specification

## Purpose

Lets members maintain their own contact/identity data per team membership, with edit and read rules that respect tenant boundaries and the team's data channel.

## Requirements

### Requirement: Profile Fields Are Membership-Scoped

The system MUST store profile fields (full name, emails, social links, GitHub username) per membership (team + member), not globally per member.

#### Scenario: Same person, different profiles per team

- GIVEN a user is a member of team A and team B
- WHEN they set a different full name in each team's profile
- THEN the system stores two independent profile records
- AND reading team A's profile MUST NOT reflect the team B edit

### Requirement: Edits Restricted to Self or Team Admin

The system MUST allow a profile field edit only when the actor is the profile owner or an admin of the same team, and MUST audit every accepted edit.

#### Scenario: Member edits own profile

- GIVEN the caller is the profile owner
- WHEN they edit a profile field
- THEN the system applies the change
- AND records an audit row (actor = owner, target = owner)

#### Scenario: Admin edits another member's profile

- GIVEN the caller is an admin of the same team as the target member
- WHEN they edit the target's profile field
- THEN the system applies the change
- AND records an audit row (actor = admin, target = member)

#### Scenario: Peer member attempts to edit another member's profile

- GIVEN the caller is a member (not admin) and not the profile owner
- WHEN they attempt to edit that profile
- THEN the system MUST refuse
- AND MUST NOT record a change (only refusal, no audit row for the field)

### Requirement: Reads Restricted to Data Channel or DM

In a team group, the system MUST answer member-data commands only when invoked inside the team's designated data channel (the forum Topic bound via `/datachannel`). In DM, the system MUST answer member-data commands for any registered member of the resolved team.

#### Scenario: Command inside data channel

- GIVEN a team's data channel is bound to a specific topic
- WHEN a member runs a member-data command inside that topic
- THEN the system replies with the requested data, scoped to that team

#### Scenario: Command outside data channel in group

- GIVEN a team's data channel is bound to a specific topic
- WHEN a member runs a member-data command elsewhere in the group (general chat or another topic)
- THEN the system MUST NOT answer with member data
- AND MUST reply directing the member to the data channel

#### Scenario: Command via DM

- GIVEN the caller is a registered member of the resolved team
- WHEN they run a member-data command in DM
- THEN the system replies with the requested data, scoped to the resolved team
