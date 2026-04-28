import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || url === "your_supabase_url_here") {
  throw new Error("SUPABASE_URL is not set in .env.local");
}
if (!key || key === "your_service_role_key_here") {
  throw new Error("SUPABASE_SERVICE_KEY is not set in .env.local");
}

export const db: SupabaseClient = createClient(url, key);

export type Company = {
  website_domain:      string;
  company_name:        string;
  aliases?:            string[];
  stage?:              string;
  tags?:               string[];
  geography?:          string;
  funding_total_usd?:  number | null;
  last_funding_date?:  string | null;
  last_funding_type?:  string | null;
  investors?:          string[];
  headcount_current?:  number | null;
  headcount_prev?:     number | null;
  headcount_updated?:  string | null;
  hotness_score?:      number;
  press_mentions_30d?: number;
  source:              string;
  source_priority:     number;
  source_url?:         string | null;
  yc_batch?:           string | null;
  yc_status?:          string | null;
  yc_top?:             boolean | null;
  short_desc?:         string | null;
  is_hiring?:          boolean | null;
  careers_url?:        string | null;
  careers_checked_at?: string | null;
};

export async function upsertCompany(company: Company): Promise<void> {
  const { error } = await db
    .from("companies")
    .upsert(company, {
      onConflict: "website_domain",
      ignoreDuplicates: false,
    });

  if (error) {
    throw new Error(`Upsert failed for ${company.website_domain}: ${error.message}`);
  }
}

export async function upsertCompanies(companies: Company[]): Promise<void> {
  if (companies.length === 0) return;

  const domains = companies.map(c => c.website_domain);

  // 1. Fetch any existing rows for these domains
  const { data: existing, error: fetchError } = await db
    .from("companies")
    .select("*")
    .in("website_domain", domains);

  if (fetchError) {
    throw new Error(`Pre-fetch failed: ${fetchError.message}`);
  }

  const existingByDomain = new Map<string, Company>(
    (existing || []).map((e: Company) => [e.website_domain, e])
  );

  const toUpsert:   Company[] = [];
  const candidates: Array<{
    domain_a:         string;
    domain_b:         string;
    company_name_a:   string;
    company_name_b:   string;
    match_reason:     string;
    similarity_score: number;
    pending_payload:  Company;
  }> = [];

  // 2. Bucket each incoming row
  for (const inc of companies) {
    const ex = existingByDomain.get(inc.website_domain);

    if (!ex) {
      // No prior row — straight insert
      toUpsert.push(inc);
      continue;
    }

    if (ex.source === inc.source) {
      // Same source refresh — upsert in place (no conflict)
      toUpsert.push(inc);
      continue;
    }

    // Cross-source conflict — divert the loser to a candidate
    if (ex.source_priority <= inc.source_priority) {
      // Existing wins (lower priority value, or tie). Stash incoming.
      candidates.push({
        domain_a:         ex.website_domain,
        domain_b:         inc.website_domain,
        company_name_a:   ex.company_name,
        company_name_b:   inc.company_name,
        match_reason:     "cross_source",
        similarity_score: 1.0,
        pending_payload:  inc,
      });
      // DO NOT upsert — leave existing intact
    } else {
      // Incoming wins. Stash existing's full row before it gets overwritten.
      candidates.push({
        domain_a:         inc.website_domain,
        domain_b:         ex.website_domain,
        company_name_a:   inc.company_name,
        company_name_b:   ex.company_name,
        match_reason:     "cross_source",
        similarity_score: 1.0,
        pending_payload:  ex,
      });
      toUpsert.push(inc);
    }
  }

  // 3. Insert candidates first — if upsert fails later, we still have the loser data
  if (candidates.length > 0) {
    const { error: candErr } = await db
      .from("duplicate_candidates")
      .insert(candidates);
    if (candErr) {
      throw new Error(`Candidate insert failed: ${candErr.message}`);
    }
  }

  // 4. Upsert winners
  if (toUpsert.length > 0) {
    const { error: upsertErr } = await db
      .from("companies")
      .upsert(toUpsert, {
        onConflict:       "website_domain",
        ignoreDuplicates: false,
      });
    if (upsertErr) {
      throw new Error(`Batch upsert failed: ${upsertErr.message}`);
    }
  }
}
