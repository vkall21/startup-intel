import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../lib/db";
import { normalizeDomain, normalizeCompanyName } from "../lib/normalize";

interface Company {
  website_domain:  string;
  company_name:    string;
  source_priority: number;
  source:          string;
}

interface DuplicateCandidate {
  domain_a:         string;
  domain_b:         string;
  company_name_a:   string;
  company_name_b:   string;
  match_reason:     string;
  similarity_score: number;
}

// Simple character-level similarity (Dice coefficient on bigrams)
function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return 0.0;

  const bigrams = (s: string) => {
    const set = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      set.set(bg, (set.get(bg) || 0) + 1);
    }
    return set;
  };

  const aMap = bigrams(a);
  const bMap = bigrams(b);
  let intersection = 0;

  for (const [bg, count] of aMap) {
    const bCount = bMap.get(bg) || 0;
    intersection += Math.min(count, bCount);
  }

  return (2 * intersection) / (a.length + b.length - 2);
}

// Detect domain variants (e.g. "stripe.com" vs "stripe.io")
function isDomainVariant(a: string, b: string): boolean {
  const rootA = a.split(".")[0];
  const rootB = b.split(".")[0];
  return rootA === rootB && a !== b;
}

async function detectDuplicates(): Promise<void> {
  console.log("\n=== Duplicate Detection ===\n");

  // Fetch all companies
  const { data: companies, error } = await db
    .from("companies")
    .select("website_domain, company_name, source_priority, source")
    .order("source_priority", { ascending: true });

  if (error) throw new Error(`Failed to fetch companies: ${error.message}`);
  if (!companies || companies.length === 0) {
    console.log("No companies found. Run ingestion first.");
    return;
  }

  console.log(`Scanning ${companies.length} companies for duplicates...\n`);

  const candidates: DuplicateCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < companies.length; i++) {
    for (let j = i + 1; j < companies.length; j++) {
      const a = companies[i] as Company;
      const b = companies[j] as Company;

      // Skip same source comparisons — only care about cross-source dupes
      if (a.source === b.source) continue;

      const pairKey = [a.website_domain, b.website_domain].sort().join("||");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      // Check 1: Exact domain match
      if (a.website_domain === b.website_domain) {
        candidates.push({
          domain_a:         a.website_domain,
          domain_b:         b.website_domain,
          company_name_a:   a.company_name,
          company_name_b:   b.company_name,
          match_reason:     "exact_domain",
          similarity_score: 1.0,
        });
        continue;
      }

      // Check 2: Domain variant (same root, different TLD)
      if (isDomainVariant(a.website_domain, b.website_domain)) {
        candidates.push({
          domain_a:         a.website_domain,
          domain_b:         b.website_domain,
          company_name_a:   a.company_name,
          company_name_b:   b.company_name,
          match_reason:     "same_domain_variant",
          similarity_score: 0.9,
        });
        continue;
      }

      // Check 3: Similar company name (Dice coefficient > 0.85)
      const normA = normalizeCompanyName(a.company_name);
      const normB = normalizeCompanyName(b.company_name);
      const score = diceCoefficient(normA, normB);

      if (score >= 0.85) {
        candidates.push({
          domain_a:         a.website_domain,
          domain_b:         b.website_domain,
          company_name_a:   a.company_name,
          company_name_b:   b.company_name,
          match_reason:     "similar_name",
          similarity_score: parseFloat(score.toFixed(3)),
        });
      }
    }
  }

  console.log(`Found ${candidates.length} duplicate candidates\n`);

  if (candidates.length === 0) {
    console.log("No duplicates detected. Your dataset is clean.");
    return;
  }

  // Print summary
  for (const c of candidates) {
    console.log(`  [${c.match_reason}] score=${c.similarity_score}`);
    console.log(`    A: ${c.company_name_a} (${c.domain_a})`);
    console.log(`    B: ${c.company_name_b} (${c.domain_b})\n`);
  }

  // Write to staging table
  console.log("Writing candidates to duplicate_candidates table...");
  const { error: insertError } = await db
    .from("duplicate_candidates")
    .insert(candidates);

  if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

  console.log(`\n✓ ${candidates.length} candidates written to duplicate_candidates`);
  console.log("Review them in Supabase before running the merge script.");
}

detectDuplicates().catch(err => {
  console.error("Detection failed:", err);
  process.exit(1);
});
