-- Hackathon analysis schema (design.md "Migration `0003_hackathon_analysis.sql`").
-- TEXT UUID ids, epoch-ms integer timestamps.

-- One row per stored analysis (design.md "Storage": the validated
-- extraction JSON, bounded; no page text). `fields`/`suggested_repos` are
-- JSON columns (ExtractedFields / RepoFullName[] respectively) so the
-- schema does not need a column per extracted field. `thread_id` is the
-- topic this analysis is currently linked to, if any (spec
-- hackathon-analysis "One Analysis Per Topic") — nullable, so the partial
-- unique index below only constrains linked rows.
CREATE TABLE hackathon_analyses (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  slug TEXT NOT NULL,
  source_url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  fields TEXT NOT NULL,
  suggested_repos TEXT NOT NULL,
  thread_id INTEGER,
  pinned_message_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (team_id, slug),
  UNIQUE (team_id, normalized_url)
);

-- design.md "One Analysis Per Topic" / task 5.2: at most one analysis may
-- be linked to a given topic per team. Partial (thread_id IS NOT NULL)
-- because most rows have no link at all.
CREATE UNIQUE INDEX hackathon_analyses_team_thread
  ON hackathon_analyses (team_id, thread_id)
  WHERE thread_id IS NOT NULL;

CREATE INDEX hackathon_analyses_team ON hackathon_analyses (team_id, created_at);

-- design.md "Cap and lease": one row per (team, UTC day). `lease_until`/
-- `lease_job_id` are the atomic lease the producer reserves alongside the
-- cap slot (design.md "reserve") so a redelivery cannot double-count.
CREATE TABLE hackathon_analysis_usage (
  team_id TEXT NOT NULL REFERENCES teams(id),
  utc_day TEXT NOT NULL CHECK (length(utc_day) = 10),
  runs INTEGER NOT NULL CHECK (runs >= 0),
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_job_id TEXT,
  PRIMARY KEY (team_id, utc_day)
);

-- design.md "Job State (D1) and Idempotency" — mirrors entities.ts's
-- AnalysisJob. `analysis_id` is set once the job reaches `persisted`;
-- `failure_reason` is a fixed, non-sensitive code (design.md "Error
-- Taxonomy"), never set until `failed`.
CREATE TABLE hackathon_analysis_jobs (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  chat_id INTEGER NOT NULL,
  thread_id INTEGER,
  utc_day TEXT NOT NULL,
  fetch_url TEXT NOT NULL CHECK (length(fetch_url) <= 2048),
  status TEXT NOT NULL CHECK (status IN ('queued','running','persisted','succeeded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_until INTEGER NOT NULL DEFAULT 0,
  analysis_id TEXT REFERENCES hackathon_analyses(id),
  failure_reason TEXT CHECK (failure_reason IS NULL OR length(failure_reason) <= 64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX hackathon_analysis_jobs_team ON hackathon_analysis_jobs (team_id, created_at);
