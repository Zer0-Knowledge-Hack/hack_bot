## Purpose

Provides a tenant-scoped feedback and bug observation inbox where team members capture unstructured notes via Telegram (text or voice), retrieve pending observations, and generate consolidated briefings without directly altering GitHub repositories.

## ADDED Requirements

### Requirement: Record Feedback and Bug Observations

The system MUST allow authenticated team members to record raw feedback or bug observations scoped to their team, submitted as text or transcribed voice messages. Each note MUST store the raw text, the author's membership identifier, the timestamp of submission, an optional target repository hint, and an initial status of `inbox`.

#### Scenario: Successfully capture a bug note with repository hint
- **WHEN** a team member records a note mentioning an explicit repository hint (e.g. `puls3`)
- **THEN** the system stores the observation in the team's inbox with `repo_hint` set to `puls3`
- **AND** sets status to `inbox`
- **AND** responds with an acknowledgment message confirming the note is recorded

#### Scenario: Successfully capture general feedback without repository hint
- **WHEN** a team member records feedback without mentioning any repository
- **THEN** the system stores the observation with `repo_hint` set to null
- **AND** sets status to `inbox`
- **AND** acknowledges receipt

#### Scenario: Non-member cannot record feedback
- **WHEN** a user who is not a registered member of the team attempts to record a note
- **THEN** the system rejects the operation
- **AND** does not persist any observation

### Requirement: Query Feedback Notes

The system MUST allow team members to list stored feedback notes for their team, optionally filtered by status (`inbox`, `triaged`, `archived`) and by target repository hint.

#### Scenario: List active inbox notes
- **WHEN** a team member requests the list of pending feedback
- **THEN** the system returns all notes with status `inbox` for that team ordered by creation time descending
- **AND** limits the output to fit within Telegram message limits

#### Scenario: Empty inbox returns designated notification
- **WHEN** a team member requests pending feedback but no notes exist in `inbox` status
- **THEN** the system returns a friendly message stating that the inbox is empty

### Requirement: Adaptive State-Driven Feedback Synthesis

The system MUST allow team members to trigger an AI-assisted synthesis of feedback notes. By default, the synthesis MUST operate on all pending notes (`status = 'inbox'`) regardless of elapsed days or intervals between notes, explicitly stating the start and end dates of the included observations. If the user specifies a natural language time window (e.g. "de hoy", "de esta semana"), the synthesis MUST narrow the selected inbox notes to that window. The output MUST group duplicate or related observations, highlight severity or impact, and format actionable suggestions ready for issue drafting, without mutating GitHub.

#### Scenario: Synthesize pending notes across irregular intervals
- **WHEN** a team member requests a summary of feedback for a repository
- **AND** the inbox contains pending notes spanning multiple days or weeks with dormant gaps
- **THEN** the system aggregates all pending notes for that repository
- **AND** generates a structured summary indicating the date span of the aggregated notes
- **AND** does not create any GitHub issues or mutate remote repositories

#### Scenario: Synthesize with temporal narrowing filter
- **WHEN** a team member explicitly asks for a summary "de hoy" or "de esta semana"
- **THEN** the system filters pending notes matching the requested time window
- **AND** generates the summary for that subset

#### Scenario: Synthesize with no notes available
- **WHEN** a team member requests a summary for a repository that has no recorded notes in the target scope
- **THEN** the system informs the caller that there are no observations to synthesize

### Requirement: Triage and Archive Feedback Notes

The system MUST allow team members to mark individual feedback notes or an entire synthesized batch as `triaged` or `archived`, removing them from the active pending inbox.

#### Scenario: Mark note as triaged
- **WHEN** a team member marks a note ID as triaged
- **THEN** the system updates its status to `triaged`
- **AND** confirms the update to the user
