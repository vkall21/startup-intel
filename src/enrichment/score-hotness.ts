import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../lib/db";

interface CompanyRow {
  website_domain:    string;
  company_name:      string;
  last_funding_date: string | null;
  press_mentions_30d: number;
  hotness_score:     number;
  source:            string;
}

function recencyScore(lastFundingDate: string | null): number {
  if (!lastFundingDate) return 0;
  const fundedAt  = new Date(lastFundingDate).getTime();
  const now       = Date.now();
  const daysAgo   = (now - fundedAt) / (1000 * 60 * 60 * 24);
  if (daysAgo <= 90)  return 1.0;
  if (daysAgo >= 730) return 0.0;
  return 1.0 - (daysAgo - 90) / (730 - 90);
}

function mentionsScore(mentions: number): number {
  if (mentions <= 0) return 0;
  return Math.min(Math.log10(mentions + 1) / Math.log10(11), 1.0);
}

function hiringScore(): number {
  // Placeholder — Phase 5 will populate headcount data
  return 0;
}

function computeHotness(company: CompanyRow): number {
  const recency  = recencyScore(company.last_funding_date);
  const hiring   = hiringScore();

  // For Product Hunt rows, use existing hotness_score as mentions proxy
  const mentionsRaw = company.source === "producthunt"
    ? Math.min((company.hotness_score || 0) / 10, 1.0)
    : mentionsScore(company.press_mentions_30d || 0);

  const raw = (recency * 0.5) + (hiring * 0.3) + (mentionsRaw * 0.2);
  return parseFloat((raw * 10).toFixed(2));
}

async function scoreHotness(): Promise<void> {
  console.log("\n=== Hotness Scoring ===\n");

  const { data: companies, error } = await db
    .from("companies")
    .select("website_domain, company_name, last_funding_date, press_mentions_30d, hotness_score, source");

  if (error) throw new Error(`Fetch failed: ${error.message}`);
  if (!companies || companies.length === 0) {
    console.log("No companies found.");
    return;
  }

  console.log(`Scoring ${companies.length} companies...\n`);

  let updated = 0;

  for (const company of companies as CompanyRow[]) {
    const score = computeHotness(company);

    const { error: updateError } = await db
      .from("companies")
      .update({ hotness_score: score })
      .eq("website_domain", company.website_domain);

    if (updateError) {
      console.error(`  ✗ ${company.company_name}: ${updateError.message}`);
    } else {
      console.log(`  ✓ ${company.company_name.padEnd(40)} score=${score.toFixed(2)}`);
      updated++;
    }
  }

  // Print top 10
  const { data: top } = await db
    .from("companies")
    .select("company_name, website_domain, stage, hotness_score")
    .order("hotness_score", { ascending: false })
    .limit(10);

  console.log("\n=== Top 10 Hottest Companies ===");
  top?.forEach((c, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${c.company_name.padEnd(35)} ${c.stage.padEnd(12)} ${c.hotness_score}`);
  });

  console.log(`\nHotness scoring complete. Updated ${updated} companies.`);
}

scoreHotness().catch(err => {
  console.error("Scoring failed:", err);
  process.exit(1);
});
