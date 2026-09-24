-- GitHub alerts schema (design.md "Data Flow" schema block).
-- Lowercase org/repo logins, epoch-ms integer timestamps.

CREATE TABLE github_org_claims (
  org_login TEXT PRIMARY KEY CHECK (org_login = lower(org_login)), -- one org -> one team
  team_id TEXT NOT NULL REFERENCES teams(id),
  created_at INTEGER NOT NULL,
  UNIQUE (team_id, org_login)
);

CREATE TABLE repo_topic_links (
  team_id TEXT NOT NULL,
  repo_full_name TEXT NOT NULL CHECK (repo_full_name = lower(repo_full_name)),
  org_login TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, repo_full_name),               -- one topic per repo per team
  FOREIGN KEY (team_id, org_login) REFERENCES github_org_claims(team_id, org_login)
);
