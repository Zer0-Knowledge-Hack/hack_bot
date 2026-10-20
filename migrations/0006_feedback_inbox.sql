-- Feedback & Bug Inbox: stores raw feedback and bug observations per team and optional repository hint.

CREATE TABLE feedback_notes (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  author_membership_id TEXT NOT NULL REFERENCES memberships(id),
  repo_hint TEXT,
  raw_text TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'text' CHECK (source_type IN ('text', 'voice')),
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox', 'triaged', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_feedback_notes_team_status ON feedback_notes(team_id, status);
CREATE INDEX idx_feedback_notes_team_repo ON feedback_notes(team_id, repo_hint);
