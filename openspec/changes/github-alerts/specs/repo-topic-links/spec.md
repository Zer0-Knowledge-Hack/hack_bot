# Repo-Topic Links Specification

## Purpose

Manages the org claim and the per-team mapping of GitHub repos to forum topics, enforcing that only claimed orgs can be linked and that link mutations are admin-only.

## Requirements

### Requirement: Org Claim Required for Linking

The system MUST allow linking a repo to a topic only if the repo's GitHub org has a `github_org_claims` row binding it to the requesting team. The claim row MUST be created by a one-time operator D1 step; no in-product command creates it in this change.

#### Scenario: Claimed org repo can be linked

- GIVEN the team's org has a `github_org_claims` row for `owner`
- WHEN a team admin runs `/linkrepo owner/repo` inside a topic
- THEN the system creates the link between `owner/repo` and that topic

#### Scenario: Unclaimed org repo is rejected

- GIVEN no `github_org_claims` row exists for `owner`
- WHEN a team admin runs `/linkrepo owner/repo` inside a topic
- THEN the system MUST refuse to create the link
- AND MUST NOT store any row for that repo

### Requirement: Admin-Only Link/Unlink Inside a Topic

The system MUST allow `/linkrepo` and `/unlinkrepo` only when run by a team admin inside a forum topic, and MUST refuse otherwise.

#### Scenario: Admin runs /linkrepo inside a topic

- GIVEN the caller is a team admin
- WHEN they run `/linkrepo owner/repo` inside a forum topic
- THEN the system processes the link request

#### Scenario: Non-admin attempts to link or unlink

- GIVEN the caller is not a team admin
- WHEN they run `/linkrepo` or `/unlinkrepo` inside a topic
- THEN the system MUST refuse
- AND MUST NOT change any stored link

#### Scenario: Admin runs the commands outside a topic

- GIVEN the caller is a team admin
- WHEN they run `/linkrepo` or `/unlinkrepo` in the group's general chat (not inside a topic)
- THEN the system MUST refuse
- AND MUST instruct the admin to run it inside the intended topic

### Requirement: One Topic Per Repo, Re-Link Moves It

The system MUST allow a repo to be linked to at most one topic per team. Linking an already-linked repo to a different topic MUST move the mapping and MUST tell the admin the previous topic is no longer receiving alerts for that repo.

#### Scenario: First link

- GIVEN `owner/repo` has no existing link for the team
- WHEN an admin runs `/linkrepo owner/repo` inside topic A
- THEN the system creates a link from `owner/repo` to topic A

#### Scenario: Re-link moves the repo

- GIVEN `owner/repo` is linked to topic A for the team
- WHEN an admin runs `/linkrepo owner/repo` inside topic B
- THEN the system updates the link to point to topic B
- AND the reply states the repo moved from topic A to topic B

### Requirement: Any Member Lists the Team's Claimed-Org Links

The system MUST allow any registered member of the team to run `/repos` anywhere in the team's group (general chat or any topic), and MUST refuse non-members. Listing is read-only. `/repos` MUST list only links for repos belonging to orgs the team has claimed.

#### Scenario: Non-admin member lists links

- GIVEN the caller is a registered team member who is not an admin
- WHEN they run `/repos` in the group's general chat
- THEN the reply lists the team's links
- AND no stored link changes

#### Scenario: Non-member runs /repos

- GIVEN the caller is not a registered member of the team
- WHEN they run `/repos` in the group
- THEN the system MUST refuse

#### Scenario: List reflects current links

- GIVEN the team has links for `owner/repo-a` and `owner/repo-b`
- WHEN a team member runs `/repos`
- THEN the reply lists both repos and their linked topics
- AND excludes any link that no longer has a matching org claim
