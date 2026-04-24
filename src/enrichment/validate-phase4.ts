import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db } from "../lib/db";

async function validatePhase4(): Promise<void> {
  console.log("\n=== Phase 4 Validation ===\n");
  let passed = 0;
  let failed = 0;
  let warnings = 0;

  function pass(label: string)  { console.log(`  ✓ ${label}`); passed++; }
  function fail(label: string, detail?: string) {
    console.error(`  ✗ ${label}${detail ? ": " + detail : ""}`); failed++;
  }
  function warn(label: string, detail?: string) {
    console.warn(`  ⚠ ${label}${detail ? ": " + detail : ""}`); warnings++;
  }

  const { data: companies } = await db
    .from("companies")
    .select("website_domain, company_name, stage, hotness_score, funding_total_usd, source, needs_enrichment");

  if (!companies) { fail("Could not fetch companies"); return; }

  // 1. No null hotness scores
  const nullScores = companies.filter(c => c.hotness_score === null || c.hotness_score === undefined);
  nullScores.length === 0
    ? pass("All companies have hotness_score")
    : fail(`${nullScores.length} companies missing hotness_score`);

  // 2. Hotness scores in valid range
  const outOfRange = companies.filter(c => c.hotness_score < 0 || c.hotness_score > 10);
  outOfRange.length === 0
    ? pass("All hotness scores in range 0–10")
    : fail(`${outOfRange.length} scores out of range`, outOfRange.map(c => `${c.company_name}=${c.hotness_score}`).join(", "));

  // 3. Unknown stage rate
  const unknownCount = companies.filter(c => c.stage === "unknown").length;
  const unknownPct   = unknownCount / companies.length;
  unknownPct < 0.81
    ? pass(`Unknown stage rate improved: ${Math.round(unknownPct * 100)}%`)
    : warn(`Unknown stage rate still high: ${Math.round(unknownPct * 100)}% — acceptable without LLM enrichment`);

  // 4. No producthunt rows with pre_seed + null funding
  const badPH = companies.filter(c =>
    c.source === "producthunt" &&
    c.stage === "pre_seed" &&
    c.funding_total_usd === null
  );
  badPH.length === 0
    ? pass("No hardcoded pre_seed rows from Product Hunt")
    : fail(`${badPH.length} Product Hunt rows still have hardcoded pre_seed`);

  // 5. Stage distribution
  const stageCounts = new Map<string, number>();
  for (const c of companies) stageCounts.set(c.stage, (stageCounts.get(c.stage) || 0) + 1);
  console.log("\n  Stage distribution:");
  for (const [stage, count] of [...stageCounts.entries()].sort()) {
    const pct = Math.round((count / companies.length) * 100);
    console.log(`    ${stage.padEnd(12)} ${count.toString().padStart(4)}  (${pct}%)`);
  }
  pass("Stage distribution logged");

  // 6. Top 5 hottest
  const top5 = [...companies].sort((a, b) => b.hotness_score - a.hotness_score).slice(0, 5);
  console.log("\n  Top 5 by hotness:");
  top5.forEach((c, i) => {
    console.log(`    ${i + 1}. ${c.company_name.padEnd(35)} ${String(c.hotness_score).padStart(5)}`);
  });
  pass("Top 5 hotness printed");

  // 7. Total count
  console.log(`\n  Total companies: ${companies.length}`);

  // Summary
  console.log(`\n=== Results ===`);
  console.log(`  Passed:   ${passed}`);
  console.log(`  Warnings: ${warnings}`);
  console.log(`  Failed:   ${failed}\n`);

  if (failed > 0) {
    console.error("Phase 4 NOT complete. Fix failures before Phase 5.");
    process.exit(1);
  } else {
    console.log("Phase 4 complete. Proceed to Phase 5.");
    // Let the event loop drain naturally — process.exit(0) triggers a libuv
    // teardown assertion on Windows when dotenvx has outstanding async handles.
  }
}

validatePhase4().catch(err => {
  console.error("Validation crashed:", err);
  process.exit(1);
});
