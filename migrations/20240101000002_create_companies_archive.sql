CREATE TABLE IF NOT EXISTS companies_archive (
  LIKE companies INCLUDING ALL,
  archived_at     TIMESTAMPTZ DEFAULT NOW(),
  archived_reason TEXT
);
