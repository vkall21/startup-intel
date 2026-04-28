import axios from "axios";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { upsertCompanies, Company } from "../lib/db";
import { normalizeDomain } from "../lib/normalize";
import { YC_BATCHES, FundingStage } from "../config";

// YC's Algolia credentials are public by design (the search-only key is
// embedded in the browser bundle at ycombinator.com/companies). The key has
// `tagFilters: ycdc_public` baked in so it can only return public-safe data.
// If this key rotates: open ycombinator.com/companies in DevTools, find any
// algolia.net network request, and grab the `x-algolia-api-key` query param.
const APP_ID  = "45BWZJ1SGC";
const API_KEY = "NzllNTY5MzJiZGM2OTY2ZTQwMDEzOTNhYWZiZGRjODlhYzVkNjBmOGRjNzJiMWM4ZTU0ZDlhYTZjOTJiMjlhMWFuYWx5dGljc1RhZ3M9eWNkYyZyZXN0cmljdEluZGljZXM9WUNDb21wYW55X3Byb2R1Y3Rpb24lMkNZQ0NvbXBhbnlfQnlfTGF1bmNoX0RhdGVfcHJvZHVjdGlvbiZ0YWdGaWx0ZXJzPSU1QiUyMnljZGNfcHVibGljJTIyJTVE";

interface YcHit {
  id?:           number;
  name?:         string;
  slug?:         string;
  website?:      string;
  batch?:        string;          // "Winter 2023"
  status?:       string;          // "Active" | "Acquired" | "Public" | "Inactive"
  stage?:        string;          // "Growth" | "Seed" | "Series A" | ...
  team_size?:    number | null;
  one_liner?:    string;
  long_description?: string;
  industry?:     string;
  industries?:   string[];
  subindustry?:  string;
  tags?:         string[];
  regions?:      string[];
  all_locations?: string;
  top_company?:  boolean;
  isHiring?:     boolean;
  nonprofit?:    boolean;
  objectID?:     string;
}

interface YcResponse {
  hits:    YcHit[];
  nbHits:  number;
  nbPages: number;
  page:    number;
}

async function fetchBatch(batch: string): Promise<YcHit[]> {
  const allHits: YcHit[] = [];
  let page = 0;
  while (true) {
    const raw = await axios.post(
      `https://${APP_ID.toLowerCase()}-dsn.algolia.net/1/indexes/YCCompany_production/query`,
      {
        query: "",
        facetFilters: [`batch:${batch}`],
        hitsPerPage: 1000,
        page,
      },
      {
        headers: {
          "X-Algolia-Application-Id": APP_ID,
          "X-Algolia-API-Key":         API_KEY,
          "Content-Type":              "application/json",
        },
        timeout: 15000,
      }
    );
    const body = raw.data as YcResponse;
    allHits.push(...body.hits);
    if (page >= body.nbPages - 1) break;
    page++;
    await new Promise(r => setTimeout(r, 200));
  }
  return allHits;
}

// Decision (a1): include "America / Canada" as US. False positives ~140
// pure-Canadian companies, but no false negatives on US ones.
function mapGeography(regions: string[] | undefined): "US" | "EU" | null {
  if (!regions || regions.length === 0) return null;
  const set = new Set(regions);
  if (set.has("United States of America") || set.has("America / Canada")) return "US";
  if (set.has("Europe") || set.has("United Kingdom")) return "EU";
  // Specific EU/UK countries that may appear without the "Europe" umbrella
  const EU_COUNTRIES = new Set([
    "France", "Germany", "Spain", "Denmark", "Netherlands", "Sweden", "Italy",
    "Ireland", "Switzerland", "Norway", "Finland", "Belgium", "Austria",
    "Poland", "Portugal", "Czech Republic", "Greece", "Romania", "Hungary",
    "Estonia", "Lithuania", "Slovakia", "Slovenia", "Croatia", "Luxembourg",
    "Iceland",
  ]);
  for (const r of regions) {
    if (EU_COUNTRIES.has(r)) return "EU";
  }
  return null;
}

// Decision (b1): map YC's `stage` field directly to our enum.
function mapYcStage(ycStage: string | undefined): FundingStage {
  if (!ycStage) return "seed"; // YC default — graduates are seed-equivalent
  const s = ycStage.toLowerCase();
  if (s.includes("pre-seed") || s.includes("pre_seed")) return "pre_seed";
  if (s.includes("seed"))                                return "seed";
  if (s.includes("series a"))                            return "series_a";
  if (s.includes("series b"))                            return "series_b";
  if (s.includes("series c") || s.includes("series d") ||
      s.includes("series e") || s.includes("series f") ||
      s.includes("growth"))                              return "growth";
  if (s.includes("public")  || s.includes("ipo"))        return "pre_ipo";
  return "seed";
}

// Synthesize last_funding_date from batch name as a recency proxy
function batchEndDate(batch: string): string | null {
  // "Winter 2023" → 2023-03-31, "Spring" → 05-31, "Summer" → 08-31, "Fall" → 11-30
  const m = batch.match(/^(Winter|Spring|Summer|Fall)\s+(\d{4})$/);
  if (!m) return null;
  const season = m[1];
  const year   = m[2];
  const monthDay =
    season === "Winter" ? "03-31" :
    season === "Spring" ? "05-31" :
    season === "Summer" ? "08-31" :
                          "11-30";
  return `${year}-${monthDay}`;
}

// Convert "Winter 2023" → "yc-w23" for tag use (short codes still useful as tags)
function batchTag(batch: string): string {
  const m = batch.match(/^(Winter|Spring|Summer|Fall)\s+(\d{4})$/);
  if (!m) return `yc-${batch.toLowerCase().replace(/\s+/g, "-")}`;
  const code = m[1][0].toLowerCase();          // W / S(pring) / S(ummer) / F
  const realCode = m[1] === "Spring" ? "x" : code;  // YC uses X for Spring
  const yr = m[2].slice(2);
  return `yc-${realCode}${yr}`;
}

function mapHitToCompany(hit: YcHit): Company | null {
  // Skip rules
  if (hit.status === "Inactive") return null;
  if (!hit.website) return null;

  const domain = normalizeDomain(hit.website);
  if (!domain) return null;

  const geography = mapGeography(hit.regions);
  if (geography === null) return null;  // honor SCOPE.geographies — skip non-US/EU

  const tags = Array.from(new Set([
    ...(hit.industries  || []).map(s => s.toLowerCase()),
    ...(hit.tags        || []).map(s => s.toLowerCase()),
    ...(hit.subindustry ? [hit.subindustry.toLowerCase()] : []),
    ...(hit.batch       ? [batchTag(hit.batch)] : []),
  ])).filter(Boolean).slice(0, 12);

  return {
    website_domain:    domain,
    company_name:      hit.name || domain,
    stage:             mapYcStage(hit.stage),
    tags,
    geography,
    funding_total_usd: null,
    last_funding_date: hit.batch ? batchEndDate(hit.batch) : null,
    last_funding_type: "yc",
    investors:         [],
    headcount_current: hit.team_size ?? null,
    source:            "yc",
    source_priority:   3,
    source_url:        hit.slug ? `https://www.ycombinator.com/companies/${hit.slug}` : null,
    short_desc:        (hit.one_liner || hit.long_description || "").slice(0, 280) || null,
    yc_batch:          hit.batch || null,
    yc_status:         hit.status || null,
    yc_top:            hit.top_company ?? null,
    is_hiring:         hit.isHiring ?? null,
  };
}

export async function runYcIngestion(): Promise<void> {
  console.log("\n=== Y Combinator Ingestion ===\n");

  let totalFetched = 0;
  let totalKept    = 0;
  let totalSkipped = 0;

  for (const batch of YC_BATCHES) {
    console.log(`\nBatch ${batch}...`);
    let hits: YcHit[];
    try {
      hits = await fetchBatch(batch);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ✗ Fetch failed for ${batch}: ${msg}`);
      continue;
    }
    if (hits.length === 0) {
      console.log(`  → No hits (batch may not exist yet)`);
      continue;
    }

    totalFetched += hits.length;

    const companies: Company[] = [];
    for (const hit of hits) {
      const mapped = mapHitToCompany(hit);
      if (mapped) {
        companies.push(mapped);
      } else {
        totalSkipped++;
      }
    }

    console.log(`  → ${hits.length} hits, ${companies.length} kept, ${hits.length - companies.length} skipped`);

    // Batch-internal dedup (rare, but defensive)
    const seen = new Set<string>();
    const deduped = companies.filter(c => {
      if (seen.has(c.website_domain)) return false;
      seen.add(c.website_domain);
      return true;
    });

    // Chunk upserts to avoid large payloads / cross-source candidate volume
    const CHUNK = 100;
    for (let i = 0; i < deduped.length; i += CHUNK) {
      await upsertCompanies(deduped.slice(i, i + CHUNK));
    }

    totalKept += deduped.length;
    await new Promise(r => setTimeout(r, 200));  // courtesy delay between batches
  }

  console.log(`\n=== YC Ingestion Complete ===`);
  console.log(`  Fetched: ${totalFetched}`);
  console.log(`  Kept:    ${totalKept}`);
  console.log(`  Skipped: ${totalSkipped} (Inactive / non-US-EU / no website / bad domain)`);
}
