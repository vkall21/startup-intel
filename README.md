# startup-intel

End-to-end pipeline for tracking early-stage startups: scrape → normalize → enrich → serve on a dashboard. Built on Supabase (Postgres) with a TypeScript ingestion layer and a Next.js frontend.

## What it does

1. **Ingests** funding announcements from TechCrunch and launch data from Product Hunt.
2. **Normalizes** — catches duplicates across sources, merges with "archive-on-merge" (no destructive deletes).
3. **Enriches** — classifies funding stage from amount/type strings and computes a hotness score per company.
4. **Serves** — a Next.js dashboard filters by stage, geography, hotness, and sort.

## Stack

| Layer | Tech |
|---|---|
| Database | Supabase (Postgres + pg_trgm + optional pg_cron/pg_net) |
| Ingestion | Node + TypeScript + Playwright + axios |
| Frontend | Next.js 16 (App Router) + Tailwind v4 |
| Scheduling | pg_cron (Supabase Pro) or GitHub Actions (free tier fallback) |

## Project layout

```
startup-intel/
├── src/
│   ├── lib/                 db + domain/name normalizers
│   ├── config.ts            SCOPE + classifyStage + STAGE_THRESHOLDS
│   ├── validate.ts          Phase 1 sanity checks
│   ├── ingestion/           TechCrunch + Product Hunt scrapers + runner
│   ├── normalization/       duplicate detection, merge, phase-3 validation
│   └── enrichment/          stage classifier, hotness scorer, phase-4 validation
├── web/                     Next.js dashboard (reads via anon key + RLS)
├── migrations/              SQL applied manually in Supabase SQL Editor
└── .github/workflows/       Weekly ingestion cron (GitHub Actions)
```

## Setup

### Prerequisites

- Node 20+
- A Supabase project
- A Product Hunt developer token ([producthunt.com/v2/oauth/applications](https://producthunt.com/v2/oauth/applications))

### 1. Install

```bash
npm install
cd web && npm install && cd ..
npx playwright install chromium
```

### 2. Configure environment

Create `.env.local` at the repo root:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service_role key — bypasses RLS, server-only>
PRODUCT_HUNT_TOKEN=<developer token>
```

Create `web/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key — safe for the browser>
```

### 3. Apply migrations

In Supabase Dashboard → SQL Editor, run each file in `migrations/` in filename order. They're idempotent (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`), so re-running is safe.

| File | Purpose |
|---|---|
| `20240101000000_create_companies.sql` | Main `companies` table + indexes + pg_trgm |
| `20240101000001_create_duplicate_candidates.sql` | Staging table for detected dupes |
| `20240101000002_create_companies_archive.sql` | Archive for merge losers |
| `20240101000003_add_enrichment_flags.sql` | `needs_enrichment`, `enrichment_source` columns |
| `20240101000004_enable_rls_companies.sql` | Public-read RLS policy for the frontend |
| `20240101000005_pg_cron_schedule.sql` | Weekly cron jobs (requires Supabase Pro) |

### 4. First validation

```bash
npm run validate
```

Runs 21 checks against `companies`. All should pass before running ingestion.

## Running the pipeline

```bash
# Ingestion
npm run ingest              # both sources
npm run ingest:tc           # TechCrunch only
npm run ingest:ph           # Product Hunt only

# Normalization (run after each ingest)
npm run detect:dupes        # write dupe pairs to staging
npm run merge:dupes:dry     # preview merges
npm run merge:dupes         # execute (archives losers)

# Enrichment
npm run enrich:stages       # rule-based stage classifier
npm run enrich:hotness      # recency/mentions scoring

# Validation gates
npm run validate:phase3     # post-normalization checks
npm run validate:phase4     # post-enrichment checks

# Frontend
npm run web                 # proxies to cd web && npm run dev
```

## Frontend

The Next.js app at `web/` reads `companies` through Supabase's REST API using the **anon key** (browser-safe) protected by a `Public read access` RLS policy. No server-side calls, no session handling.

```bash
cd web
npm run dev        # http://localhost:3000
npm run build      # production build
```

Tailwind v4 is used (`@import "tailwindcss"` in `globals.css`). If you're porting this to another project, don't swap in the v3 `@tailwind base; @tailwind components; @tailwind utilities;` directive form — they compile to nothing in v4.

## Scheduling

Two paths, pick one (running both double-ingests):

**Supabase Pro (pg_cron):** run `migrations/20240101000005_pg_cron_schedule.sql`. The scheduled jobs call `net.http_post` against a URL stored in `app.ingest_webhook_url`. You still need to deploy a webhook endpoint (Supabase Edge Function or similar) that runs `npm run ingest` on POST, then:

```sql
ALTER DATABASE postgres SET app.ingest_webhook_url = 'https://<your-webhook>';
```

**Free tier (GitHub Actions):** `.github/workflows/ingest.yml` runs weekly. In your GitHub repo, add `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as Actions secrets. No webhook needed.

## Data model

The canonical schema lives in `migrations/20240101000000_create_companies.sql`. Key columns:

| Column | Type | Notes |
|---|---|---|
| `website_domain` | TEXT PK | lowercase, normalized via `tldts` — the dedup key |
| `company_name` | TEXT | |
| `stage` | funding_stage enum | `pre_seed` / `seed` / `series_a` / `series_b` / `growth` / `pre_ipo` / `unknown` |
| `funding_total_usd` | BIGINT | |
| `last_funding_date` | DATE | |
| `hotness_score` | NUMERIC(5,2) | 0–10 |
| `source` | TEXT | `techcrunch` / `producthunt` |
| `source_priority` | SMALLINT | lower wins during merges |
| `needs_enrichment` | BOOLEAN | set FALSE once a classifier has resolved `stage` |

## Known limitations

- **TechCrunch website extraction is noisy.** The scraper picks the first non-filtered outbound link from the article body. Sometimes that's a citation (Bloomberg, NEA VC page) rather than the subject company. Dedup filter in `techcrunch.ts` helps but doesn't eliminate it.
- **Product Hunt has no funding signal.** PH ingestion leaves `stage=unknown` and `funding_total_usd=null` — the classifier can't resolve these without an LLM/enrichment step.
- **Upsert overwrites cross-source data.** Because `website_domain` is the primary key, a later source (PH) overwrites an earlier source (TC) when they share a domain. `duplicate_candidates` detection only fires on *cross-source* pairs, so these overwrites happen silently.
- **`hiring` component of hotness score is stubbed at 0** pending a headcount-tracking integration.

## License

MIT
