import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../lib/db";
import { classifyStage, FundingStage } from "../config";

interface CompanyRow {
  website_domain:    string;
  company_name:      string;
  stage:             string;
  funding_total_usd: number | null;
  last_funding_type: string | null;
  source:            string;
}

// Classify from funding type string when amount is missing
function classifyFromFundingType(fundingType: string | null): FundingStage {
  if (!fundingType) return "unknown";
  const t = fundingType.toLowerCase();
  if (t.includes("pre-seed") || t.includes("pre_seed")) return "pre_seed";
  if (t.includes("seed"))     return "seed";
  if (t.includes("series a")) return "series_a";
  if (t.includes("series b")) return "series_b";
  if (t.includes("series c") || t.includes("series d") || t.includes("series e")) return "growth";
  if (t.includes("growth"))   return "growth";
  if (t.includes("pre-ipo") || t.includes("pre_ipo")) return "pre_ipo";
  if (t.includes("venture"))  return "seed";
  if (t.includes("angel"))    return "pre_seed";
  return "unknown";
}

async function classifyStages(): Promise<void> {
  console.log("\n=== Stage Classification (Rule-based) ===\n");

  // Paginate — Supabase caps a default select() at 1000 rows.
  const PAGE = 1000;
  const companies: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("companies")
      .select("website_domain, company_name, stage, funding_total_usd, last_funding_type, source")
      .eq("needs_enrichment", true)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    companies.push(...data);
    if (data.length < PAGE) break;
  }
  if (companies.length === 0) {
    console.log("No companies need enrichment.");
    return;
  }

  console.log(`Processing ${companies.length} companies...\n`);

  let classifiedByAmount = 0;
  let classifiedByType   = 0;
  let stillUnknown       = 0;

  for (const company of companies as CompanyRow[]) {
    let newStage: FundingStage = "unknown";
    let method = "";

    // Method 1: classify by funding amount (most reliable)
    if (company.funding_total_usd !== null && company.funding_total_usd >= 0) {
      newStage = classifyStage(company.funding_total_usd);
      method = "amount";
      classifiedByAmount++;
    }
    // Method 2: classify by funding type string
    else if (company.last_funding_type) {
      newStage = classifyFromFundingType(company.last_funding_type);
      if (newStage !== "unknown") {
        method = "type_string";
        classifiedByType++;
      } else {
        stillUnknown++;
      }
    }
    else {
      stillUnknown++;
    }

    if (newStage === "unknown") {
      console.log(`  ~ ${company.company_name} (${company.website_domain}) — still unknown`);
      continue;
    }

    // Update stage and mark enrichment source (newStage is guaranteed non-"unknown" here)
    const { error: updateError } = await db
      .from("companies")
      .update({
        stage:             newStage,
        enrichment_source: `rule:${method}`,
        needs_enrichment:  false,
      })
      .eq("website_domain", company.website_domain);

    if (updateError) {
      console.error(`  ✗ Update failed for ${company.website_domain}: ${updateError.message}`);
    } else {
      console.log(`  ✓ ${company.company_name} → ${newStage} (via ${method})`);
    }
  }

  console.log("\n=== Classification Summary ===");
  console.log(`  Classified by amount:      ${classifiedByAmount}`);
  console.log(`  Classified by type string: ${classifiedByType}`);
  console.log(`  Still unknown:             ${stillUnknown}`);
  console.log(`  (Unknown rows flagged for LLM enrichment in next step)`);

  // Final distribution — paginate too so the count reflects the whole table.
  const dist: { stage: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("companies")
      .select("stage")
      .range(from, from + PAGE - 1);
    if (error) break;
    if (!data || data.length === 0) break;
    dist.push(...data);
    if (data.length < PAGE) break;
  }
  if (dist.length > 0) {
    const counts = new Map<string, number>();
    for (const row of dist) counts.set(row.stage, (counts.get(row.stage) || 0) + 1);
    console.log("\n  Updated stage distribution:");
    for (const [stage, count] of [...counts.entries()].sort()) {
      console.log(`    ${stage}: ${count}`);
    }
  }
}

classifyStages().catch(err => {
  console.error("Classification failed:", err);
  process.exit(1);
});
