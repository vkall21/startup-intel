CREATE TABLE IF NOT EXISTS duplicate_candidates (
  id                  SERIAL PRIMARY KEY,
  domain_a            TEXT NOT NULL,
  domain_b            TEXT NOT NULL,
  company_name_a      TEXT NOT NULL,
  company_name_b      TEXT NOT NULL,
  match_reason        TEXT NOT NULL,  -- 'exact_domain', 'similar_name', 'same_domain_variant'
  similarity_score    NUMERIC(4,3),   -- 0.0 to 1.0
  resolved            BOOLEAN DEFAULT FALSE,
  winner_domain       TEXT,           -- set during merge step
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dupes_resolved ON duplicate_candidates (resolved);
CREATE INDEX IF NOT EXISTS idx_dupes_domain_a ON duplicate_candidates (domain_a);
