-- Hackathon participation (design.md "Migration / Rollout"). Additive only:
-- old Workers ignore both columns, so rollback is a plain redeploy.

-- Message id of the General analysis post that carries the "Participamos"
-- button, so `/hackathon join` can remove it. Null for analyses posted before
-- this migration or when storing the id failed (best-effort).
ALTER TABLE hackathon_analyses ADD COLUMN general_message_id INTEGER;

-- Epoch-ms until which a topic-creation claim is held (compare-and-set lease,
-- design.md decision 3). 0 = no claim; expired claims can be re-taken.
ALTER TABLE hackathon_analyses ADD COLUMN topic_claim_until INTEGER NOT NULL DEFAULT 0;
