-- Best-effort careers page URL discovered by HEAD-probing common paths
-- (/careers, /jobs, /join, etc.) for each company's domain. Refreshed
-- by `npm run enrich:careers` — see src/enrichment/find-careers.ts.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS careers_url        TEXT,
  ADD COLUMN IF NOT EXISTS careers_checked_at TIMESTAMPTZ;

ALTER TABLE companies_archive
  ADD COLUMN IF NOT EXISTS careers_url        TEXT,
  ADD COLUMN IF NOT EXISTS careers_checked_at TIMESTAMPTZ;

-- Partial index — most queries will be "show me the link if we have one"
CREATE INDEX IF NOT EXISTS idx_companies_careers_url
  ON companies (website_domain) WHERE careers_url IS NOT NULL;
