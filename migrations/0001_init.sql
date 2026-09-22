-- Team Foundation schema (design.md "Data Flow" schema block).
-- TEXT UUID ids, epoch-ms integer timestamps.

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  telegram_chat_id INTEGER NOT NULL UNIQUE,
  data_topic_thread_id INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
  joined_at INTEGER NOT NULL,
  UNIQUE (team_id, member_id),
  UNIQUE (team_id, id)
);

CREATE TABLE profile_fields (
  team_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  field TEXT NOT NULL CHECK (
    field IN ('full_name', 'emails', 'social_links', 'github_username')
  ),
  value BLOB NOT NULL,
  key_version INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, membership_id, field),
  FOREIGN KEY (team_id, membership_id) REFERENCES memberships(team_id, id)
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  actor_membership_id TEXT NOT NULL,
  target_membership_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value BLOB,
  new_value BLOB,
  key_version INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (team_id, actor_membership_id) REFERENCES memberships(team_id, id),
  FOREIGN KEY (team_id, target_membership_id) REFERENCES memberships(team_id, id)
);

CREATE INDEX idx_audit_log_team_target_created
  ON audit_log (team_id, target_membership_id, created_at);

CREATE TABLE dm_selections (
  telegram_user_id INTEGER PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  expires_at INTEGER NOT NULL
);
