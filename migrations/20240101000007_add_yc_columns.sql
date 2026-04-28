ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS yc_batch   TEXT,
  ADD COLUMN IF NOT EXISTS yc_status  TEXT,
  ADD COLUMN IF NOT EXISTS yc_top     BOOLEAN,
  ADD COLUMN IF NOT EXISTS short_desc TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_yc_batch ON companies (yc_batch);
