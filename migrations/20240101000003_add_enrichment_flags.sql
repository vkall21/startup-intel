ALTER TABLE companies ADD COLUMN IF NOT EXISTS needs_enrichment BOOLEAN DEFAULT TRUE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS enrichment_source TEXT;

-- Mark all rows as needing enrichment
UPDATE companies SET needs_enrichment = TRUE;

-- Reset Product Hunt hardcoded stages
UPDATE companies
SET stage = 'unknown'
WHERE source = 'producthunt'
  AND stage = 'pre_seed'
  AND funding_total_usd IS NULL;
