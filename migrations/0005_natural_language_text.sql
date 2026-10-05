-- Natural-language text (design.md "Migration / Rollout"): confirm tokens
-- and soft per-team classify quota. Applied for PR2; confirm rows are unused
-- until PR3 mutate path lands.

-- Pending NL confirmations (TTL 10 minutes, CAS consume). slots_json may hold
-- short-lived plaintext profile values — never log row contents.
CREATE TABLE nl_confirmations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  chat_id INTEGER NOT NULL,
  thread_id INTEGER,
  actor_membership_id TEXT NOT NULL REFERENCES memberships(id),
  intent TEXT NOT NULL,
  slots_json TEXT NOT NULL,
  confirm_message_id INTEGER,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Lookup for affirmative reply to the confirm message (design.md decision 3).
CREATE UNIQUE INDEX nl_confirmations_chat_msg
  ON nl_confirmations (chat_id, confirm_message_id)
  WHERE confirm_message_id IS NOT NULL;

CREATE INDEX nl_confirmations_team_expires
  ON nl_confirmations (team_id, expires_at);

-- Soft classify cap: one row per (team, UTC day). Domain constant is 100.
CREATE TABLE nl_classify_quota (
  team_id TEXT NOT NULL REFERENCES teams(id),
  day_utc TEXT NOT NULL CHECK (length(day_utc) = 10),
  count INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (team_id, day_utc)
);
