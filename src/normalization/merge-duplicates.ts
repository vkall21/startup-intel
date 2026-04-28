import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { db, Company } from "../lib/db";

interface DuplicateCandidate {
  id:               number;
  domain_a:         string;
  domain_b:         string;
  company_name_a:   string;
  company_name_b:   string;
  match_reason:     string;
  similarity_score: number;
  pending_payload?: Company;
}

// Merge loser fields into winner — winner fields always take precedence
function mergeCompanies(winner: Company, loser: Company): Partial<Company> {
  return {
    // Arrays: union of both, deduped
    aliases:   [...new Set([
      ...(winner.aliases   || []),
      ...(loser.aliases    || []),
      loser.company_name,
    ])],
    investors: [...new Set([
      ...(winner.investors || []),
      ...(loser.investors  || []),
    ])],
    tags: [...new Set([
      ...(winner.tags || []),
      ...(loser.tags  || []),
    ])],

    // Numeric: take winner unless null, then fall back to loser
    funding_total_usd:  winner.funding_total_usd  ?? loser.funding_total_usd,
    headcount_current:  winner.headcount_current  ?? loser.headcount_current,
    headcount_prev:     winner.headcount_prev     ?? loser.headcount_prev,
    press_mentions_30d: Math.max(
      winner.press_mentions_30d || 0,
      loser.press_mentions_30d  || 0
    ),

    // Dates: take most recent
    last_funding_date: [winner.last_funding_date, loser.last_funding_date]
      .filter(Boolean)
      .sort()
      .reverse()[0] ?? null,

    // Strings: winner always wins
    stage:             winner.stage            || loser.stage,
    geography:         winner.geography        || loser.geography,
    last_funding_type: winner.last_funding_type || loser.last_funding_type,
  };
}

async function mergeDuplicates(dryRun: boolean = false): Promise<void> {
  console.log(`\n=== Merge Duplicates ${dryRun ? "(DRY RUN)" : ""} ===\n`);

  // Fetch unresolved candidates
  const { data: candidates, error } = await db
    .from("duplicate_candidates")
    .select("*")
    .eq("resolved", false)
    .order("similarity_score", { ascending: false });

  if (error) throw new Error(`Failed to fetch candidates: ${error.message}`);
  if (!candidates || candidates.length === 0) {
    console.log("No unresolved duplicates found.");
    return;
  }

  console.log(`Processing ${candidates.length} duplicate pairs...\n`);

  let merged = 0;
  let skipped = 0;

  for (const candidate of candidates as DuplicateCandidate[]) {
    let rowA: Company;
    let rowB: Company;

    if (candidate.match_reason === "cross_source") {
      // Companies has the winner from ingest time; the loser is in pending_payload.
      if (!candidate.pending_payload) {
        console.log(`  ✗ Skipped cross_source pair — pending_payload missing`);
        skipped++;
        continue;
      }
      const { data: rows, error: fetchError } = await db
        .from("companies")
        .select("*")
        .eq("website_domain", candidate.domain_a)
        .limit(1);
      if (fetchError || !rows || rows.length === 0) {
        console.log(`  ✗ Skipped cross_source pair (${candidate.domain_a}) — winner row not found`);
        skipped++;
        continue;
      }
      rowA = rows[0] as Company;
      rowB = candidate.pending_payload as Company;
    } else {
      // Legacy path: both rows live in companies (similar_name, same_domain_variant)
      const { data: rows, error: fetchError } = await db
        .from("companies")
        .select("*")
        .in("website_domain", [candidate.domain_a, candidate.domain_b]);
      if (fetchError || !rows || rows.length < 2) {
        console.log(`  ✗ Skipped pair (${candidate.domain_a} / ${candidate.domain_b}) — one or both not found`);
        skipped++;
        continue;
      }
      rowA = rows[0] as Company;
      rowB = rows[1] as Company;
    }

    // Determine winner by source_priority (lower = more trusted)
    const winner = rowA.source_priority <= rowB.source_priority ? rowA : rowB;
    const loser  = rowA.source_priority <= rowB.source_priority ? rowB : rowA;

    console.log(`  Merging: [${candidate.match_reason}]`);
    console.log(`    Winner: ${winner.company_name} (${winner.website_domain}) — priority ${winner.source_priority}`);
    console.log(`    Loser:  ${loser.company_name}  (${loser.website_domain})  — priority ${loser.source_priority}`);

    if (dryRun) {
      console.log(`    → DRY RUN: would merge and archive ${loser.website_domain}\n`);
      merged++;
      continue;
    }

    // Archive the loser
    const { error: archiveError } = await db
      .from("companies_archive")
      .insert({
        ...loser,
        archived_reason: `merged into ${winner.website_domain} — reason: ${candidate.match_reason}`,
      });

    if (archiveError) {
      console.error(`    ✗ Archive failed: ${archiveError.message}`);
      skipped++;
      continue;
    }

    // Apply merged fields to winner
    const mergedFields = mergeCompanies(winner, loser);
    const { error: updateError } = await db
      .from("companies")
      .update(mergedFields)
      .eq("website_domain", winner.website_domain);

    if (updateError) {
      console.error(`    ✗ Update failed: ${updateError.message}`);
      skipped++;
      continue;
    }

    if (candidate.match_reason !== "cross_source") {
      // Legacy path: loser is a real row in companies — delete it.
      // For cross_source, the loser was never inserted, so nothing to delete.
      const { error: deleteError } = await db
        .from("companies")
        .delete()
        .eq("website_domain", loser.website_domain);

      if (deleteError) {
        console.error(`    ✗ Delete failed: ${deleteError.message}`);
        skipped++;
        continue;
      }
    }

    // Mark candidate as resolved
    await db
      .from("duplicate_candidates")
      .update({ resolved: true, winner_domain: winner.website_domain })
      .eq("id", candidate.id);

    console.log(`    ✓ Merged and archived ${loser.website_domain}\n`);
    merged++;
  }

  console.log("=== Merge Complete ===");
  console.log(`  Merged:  ${merged}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Archived rows visible in: companies_archive table`);
}

// Run dry run first, then real merge
const args = process.argv.slice(2);
const dryRun = !args.includes("--confirm");

if (dryRun) {
  console.log("Running in DRY RUN mode. Pass --confirm to execute real merge.");
}

mergeDuplicates(dryRun).catch(err => {
  console.error("Merge failed:", err);
  process.exit(1);
});
