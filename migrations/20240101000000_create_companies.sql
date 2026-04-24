-- Enable fuzzy matching extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Funding stage enum
DO $$ BEGIN
  CREATE TYPE funding_stage AS ENUM (
    'pre_seed', 'seed', 'series_a', 'series_b',
    'growth', 'pre_ipo', 'unknown'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Main companies table
CREATE TABLE IF NOT EXISTS companies (
  -- Identity
  website_domain      TEXT PRIMARY KEY,
  company_name        TEXT NOT NULL,
  aliases             TEXT[],

  -- Classification
  stage               funding_stage DEFAULT 'unknown',
  tags                TEXT[],
  geography           TEXT,

  -- Funding
  funding_total_usd   BIGINT,
  last_funding_date   DATE,
  last_funding_type   TEXT,
  investors           TEXT[],

  -- Hiring signals
  headcount_current   INT,
  headcount_prev      INT,
  headcount_updated   DATE,

  -- Intelligence
  hotness_score       NUMERIC(5,2) DEFAULT 0,
  press_mentions_30d  INT DEFAULT 0,

  -- Provenance
  source              TEXT NOT NULL,
  source_priority     SMALLINT NOT NULL,
  source_url          TEXT,

  -- Housekeeping
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_companies_stage
  ON companies (stage);

CREATE INDEX IF NOT EXISTS idx_companies_hotness
  ON companies (hotness_score DESC);

CREATE INDEX IF NOT EXISTS idx_companies_last_funding
  ON companies (last_funding_date DESC);

CREATE INDEX IF NOT EXISTS idx_companies_tags
  ON companies USING GIN (tags);

CREATE INDEX IF NOT EXISTS idx_companies_investors
  ON companies USING GIN (investors);

CREATE INDEX IF NOT EXISTS idx_name_trgm
  ON companies USING GIN (company_name gin_trgm_ops);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_updated ON companies;

CREATE TRIGGER trg_companies_updated
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
