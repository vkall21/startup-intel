ALTER TABLE duplicate_candidates
  ADD COLUMN IF NOT EXISTS pending_payload JSONB;
