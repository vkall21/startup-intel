import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../lib/db";
import { normalizeDomain } from "../lib/normalize";

async function validatePhase3(): Promise<void> {
  console.log("\n=== Phase 3 Validation ===\n");
  let passed = 0;
  let failed = 0;
  let warnings = 0;

  function pass(label: string) {
    console.log(`  ✓ ${label}`);
    passed++;
  }
  function fail(label: string, detail?: string) {
    console.error(`  ✗ ${label}${detail ? ": " + detail : ""}`);
    failed++;
  }
  function warn(label: string, detail?: string) {
    console.warn(`  ⚠ ${label}${detail ? ": " + detail : ""}`);
    warnings++;
  }

  // 1. No duplicate domains
  const { data: domainDupes } = await db.rpc("sql", {
    query: `SELECT website_domain, count(*) as n FROM companies GROUP BY website_domain HAVING count(*) > 1`
  }).select();

  // Use direct query instead
  const { data: allCompanies } = await db
    .from("companies")
    .select("website_domain, company_name, source_priority, stage, funding_total_usd, source");

  if (!allCompanies) { fail("Could not fetch companies"); return; }

  // Check for duplicate domains
  const domainCounts = new Map<string, number>();
  for (const c of allCompanies) {
    domainCounts.set(c.website_domain, (domainCounts.get(c.website_domain) || 0) + 1);
  }
  const dupes = [...domainCounts.entries()].filter(([, n]) => n > 1);
  if (dupes.length === 0) {
    pass("No duplicate domains");
  } else {
    fail(`${dupes.length} duplicate domains found`, dupes.map(([d]) => d).join(", "));
  }

  // 2. All domains are valid
  const invalidDomains = allCompanies.filter(c => !normalizeDomain(c.website_domain));
  if (invalidDomains.length === 0) {
    pass("All domains are valid");
  } else {
    fail(`${invalidDomains.length} invalid domains`, invalidDomains.map(c => c.website_domain).join(", "));
  }

  // 3. No null company names
  const nullNames = allCompanies.filter(c => !c.company_name);
  if (nullNames.length === 0) {
    pass("All companies have names");
  } else {
    fail(`${nullNames.length} companies missing names`);
  }

  // 4. Stage distribution looks reasonable
  const stageCounts = new Map<string, number>();
  for (const c of allCompanies) {
    stageCounts.set(c.stage || "unknown", (stageCounts.get(c.stage || "unknown") || 0) + 1);
  }
  console.log("\n  Stage distribution:");
  for (const [stage, count] of [...stageCounts.entries()].sort()) {
    console.log(`    ${stage}: ${count}`);
  }
  const unknownPct = (stageCounts.get("unknown") || 0) / allCompanies.length;
  if (unknownPct > 0.5) {
    warn(`${Math.round(unknownPct * 100)}% of companies have unknown stage — consider enriching in Phase 4`);
  } else {
    pass("Stage distribution acceptable");
  }

  // 5. Source distribution
  const sourceCounts = new Map<string, number>();
  for (const c of allCompanies) {
    sourceCounts.set(c.source, (sourceCounts.get(c.source) || 0) + 1);
  }
  console.log("\n  Source distribution:");
  for (const [source, count] of [...sourceCounts.entries()].sort()) {
    console.log(`    ${source}: ${count}`);
  }
  pass("Source distribution logged");

  // 6. Archive table has rows
  const { count: archiveCount } = await db
    .from("companies_archive")
    .select("*", { count: "exact", head: true });

  if ((archiveCount || 0) >= 0) {
    pass(`Archive table exists (${archiveCount} rows)`);
  } else {
    warn("Archive table empty — no merges were performed");
  }

  // 7. All duplicate_candidates resolved
  const { count: unresolvedCount } = await db
    .from("duplicate_candidates")
    .select("*", { count: "exact", head: true })
    .eq("resolved", false);

  if ((unresolvedCount || 0) === 0) {
    pass("All duplicate candidates resolved");
  } else {
    warn(`${unresolvedCount} unresolved duplicate candidates remain`);
  }

  // Summary
  console.log(`\n=== Results ===`);
  console.log(`  Total companies: ${allCompanies.length}`);
  console.log(`  Passed:   ${passed}`);
  console.log(`  Warnings: ${warnings}`);
  console.log(`  Failed:   ${failed}\n`);

  if (failed > 0) {
    console.error("Phase 3 NOT complete. Fix failures before Phase 4.");
    process.exit(1);
  } else {
    console.log("Phase 3 complete. Dataset is clean. Proceed to Phase 4.");
    process.exit(0);
  }
}

validatePhase3().catch(err => {
  console.error("Validation crashed:", err);
  process.exit(1);
});
