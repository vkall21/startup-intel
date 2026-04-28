-- Bring companies_archive schema in sync with companies after Phase 4 + Phase B
-- column additions. Required because the archive was created with
-- `LIKE companies INCLUDING ALL` in Phase 3 — that's a one-time snapshot, not
-- a live mirror.
ALTER TABLE companies_archive ADD COLUMN IF NOT EXISTS enrichment_source TEXT;
ALTER TABLE companies_archive ADD COLUMN IF NOT EXISTS needs_enrichment  BOOLEAN;
ALTER TABLE companies_archive ADD COLUMN IF NOT EXISTS yc_batch          TEXT;
ALTER TABLE companies_archive ADD COLUMN IF NOT EXISTS yc_status         TEXT;
ALTER TABLE companies_archive ADD COLUMN IF NOT EXISTS yc_top            BOOLEAN;
ALTER TABLE companies_archive ADD COLUMN IF NOT EXISTS short_desc        TEXT;
