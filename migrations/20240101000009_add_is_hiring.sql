ALTER TABLE companies         ADD COLUMN IF NOT EXISTS is_hiring BOOLEAN;
ALTER TABLE companies_archive ADD COLUMN IF NOT EXISTS is_hiring BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_companies_is_hiring ON companies (is_hiring) WHERE is_hiring = TRUE;
