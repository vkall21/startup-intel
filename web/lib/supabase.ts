import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!url || !key) {
  throw new Error("Missing Supabase env vars. Check web/.env.local");
}

export const supabase = createClient(url, key);

export type Company = {
  website_domain:     string;
  company_name:       string;
  stage:              string;
  tags:               string[] | null;
  geography:          string | null;
  funding_total_usd:  number | null;
  last_funding_date:  string | null;
  last_funding_type:  string | null;
  investors:          string[] | null;
  hotness_score:      number;
  press_mentions_30d: number;
  source:             string;
  source_url:         string | null;
  created_at:         string;
  yc_batch:           string | null;
  yc_status:          string | null;
  yc_top:             boolean | null;
  short_desc:         string | null;
  is_hiring:          boolean | null;
  careers_url:        string | null;
  careers_checked_at: string | null;
};
