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

  const { error } = await db
    .from("companies")
    .upsert(companies, {
      onConflict: "website_domain",
      ignoreDuplicates: false,
    });

  if (error) {
    throw new Error(`Batch upsert failed: ${error.message}`);
  }
}
