import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db, upsertCompany } from "./lib/db";
import { normalizeDomain, normalizeCompanyName, normalizeInvestors } from "./lib/normalize";
import { classifyStage } from "./config";
import { describeError, describeDbError } from "./lib/errors";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";

async function runValidation() {
  console.log("\n=== Phase 1 Validation ===\n");
  let passed = 0;
  let failed = 0;

  function assert(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.error(`  ✗ ${label}`);
      console.error(`    Expected: ${JSON.stringify(expected)}`);
      console.error(`    Actual:   ${JSON.stringify(actual)}`);
      failed++;
    }
  }

  // --- normalizeDomain ---
  console.log("normalizeDomain:");
  assert("strips https and www",       normalizeDomain("https://www.OpenAI.com/about"), "openai.com");
  assert("handles no scheme",           normalizeDomain("stripe.com"),                  "stripe.com");
  assert("lowercases",                  normalizeDomain("ANTHROPIC.COM"),               "anthropic.com");
  assert("returns null for empty",      normalizeDomain(""),                             null);
  assert("returns null for gibberish",  normalizeDomain("not-a-domain"),                null);

  // --- normalizeCompanyName ---
  console.log("\nnormalizeCompanyName:");
  assert("strips Inc",    normalizeCompanyName("OpenAI Inc."),          "openai");
  assert("strips Corp",   normalizeCompanyName("Stripe Corp"),          "stripe");
  assert("strips Tech",   normalizeCompanyName("Anthropic Technologies"),"anthropic");
  assert("strips AI",     normalizeCompanyName("DeepMind AI"),          "deepmind");

  // --- classifyStage ---
  console.log("\nclassifyStage:");
  assert("null → unknown",           classifyStage(null),         "unknown");
  assert("0 → pre_seed",             classifyStage(0),            "pre_seed");
  assert("1M → seed",                classifyStage(1_000_000),    "seed");
  assert("10M → series_a",           classifyStage(10_000_000),   "series_a");
  assert("50M → series_b",           classifyStage(50_000_000),   "series_b");
  assert("200M → growth",            classifyStage(200_000_000),  "growth");
  assert("600M → pre_ipo",           classifyStage(600_000_000),  "pre_ipo");

  // --- Supabase connection ---
  console.log("\nSupabase connection:");
  try {
    const { error } = await db.from("companies").select("website_domain").limit(1);
    if (error) throw error;
    console.log("  ✓ Connection successful");
    console.log("  ✓ companies table exists");
    passed += 2;
  } catch (e: unknown) {
    console.error(`  ✗ Supabase connection failed: ${describeDbError(e, SUPABASE_URL)}`);
    failed += 2;
  }

  // --- Upsert test ---
  console.log("\nUpsert test:");
  const testCompany = {
    website_domain:     "test-validate-phase1.com",
    company_name:       "Test Validate Phase1",
    stage:              "seed" as const,
    tags:               ["test", "validation"],
    geography:          "US",
    funding_total_usd:  1_000_000,
    last_funding_date:  "2024-01-01",
    investors:          ["test investor"],
    source:             "validation",
    source_priority:    5,
  };

  try {
    await upsertCompany(testCompany);
    console.log("  ✓ Upsert succeeded");
    passed++;
  } catch (e: unknown) {
    // upsertCompany already annotates DB-reachability failures — don't re-wrap.
    console.error(`  ✗ Upsert failed: ${describeError(e)}`);
    failed++;
  }

  // --- Cleanup test row ---
  // supabase-js reports failures in the returned `error`, not by throwing —
  // checking only for a thrown exception passed this even against a dead host.
  try {
    const { error } = await db
      .from("companies")
      .delete()
      .eq("website_domain", "test-validate-phase1.com");
    if (error) throw error;
    console.log("  ✓ Cleanup succeeded");
    passed++;
  } catch (e: unknown) {
    console.error(`  ✗ Cleanup failed: ${describeDbError(e, SUPABASE_URL)}`);
    failed++;
  }

  // --- pg_trgm check ---
  // This probe used to `db.rpc("similarity", { arg1, arg2 })`, which can never
  // succeed: pg_trgm's similarity(text, text) has unnamed parameters, so
  // PostgREST cannot bind named args to it, and PostgREST only exposes routines
  // in the exposed schema anyway. It always returned PGRST202, and the old
  // string match ("function similarity") missed the actual wording ("function
  // public.similarity"), so this reported a PASS on every run — including
  // against a database that did not exist.
  //
  // Nothing in the pipeline calls SQL similarity(): detect-duplicates.ts scores
  // pairs with its own Dice coefficient in TypeScript. So there is nothing here
  // to gate on. Report the extension as unverified rather than inventing a
  // verdict in either direction.
  console.log("\npg_trgm extension:");
  console.log("  ~ not verified — cannot be probed over PostgREST, and the");
  console.log("    pipeline does not use SQL similarity() (dedup scores in JS).");
  console.log("    Confirm in the SQL editor if you need it:");
  console.log("    SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm';");

  // --- Summary ---
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    console.error("Phase 1 is NOT complete. Fix the failures above before proceeding to Phase 2.");
    process.exit(1);
  } else {
    console.log("Phase 1 complete. All checks passed. Proceed to Phase 2.");
    process.exit(0);
  }
}

runValidation().catch(err => {
  console.error("Validation crashed:", err);
  process.exit(1);
});
