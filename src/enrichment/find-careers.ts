import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import axios, { AxiosError } from "axios";
import { db } from "../lib/db";

// Probed in this order — first 2xx wins. Ordered by empirical commonality
// among early-stage startup sites.
const CAREERS_PATHS = [
  "/careers",
  "/jobs",
  "/career",
  "/join",
  "/company/careers",
  "/about/careers",
  "/work-with-us",
];

// Tried after all root paths fail. Many companies host careers off a
// dedicated subdomain pointing at an ATS (Greenhouse, Lever, etc.).
const CAREERS_SUBDOMAINS = ["careers", "jobs"];

// Looks like a normal browser so we don't get blocked by bot-protection
// rules that reject default User-Agent strings.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 5000;
const DELAY_BETWEEN_COMPANIES_MS = 200;
const DEFAULT_RECHECK_DAYS = 30;

interface CompanyRow {
  website_domain:     string;
  company_name:       string;
  source:             string;
  careers_checked_at: string | null;
}

interface CliFlags {
  force:    boolean;
  limit:    number | null;
  source:   string | null;
  recheckDays: number;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { force: false, limit: null, source: null, recheckDays: DEFAULT_RECHECK_DAYS };
  for (const a of argv) {
    if (a === "--force") flags.force = true;
    else if (a.startsWith("--limit="))   flags.limit  = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--source="))  flags.source = a.split("=")[1];
    else if (a.startsWith("--recheck-days=")) flags.recheckDays = parseInt(a.split("=")[1], 10);
  }
  return flags;
}

// Fetch all candidates with explicit pagination — Supabase caps default
// select() at 1000 rows.
async function fetchCandidates(flags: CliFlags): Promise<CompanyRow[]> {
  const PAGE = 1000;
  const all: CompanyRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db
      .from("companies")
      .select("website_domain, company_name, source, careers_checked_at")
      .range(from, from + PAGE - 1);

    if (flags.source) query = query.eq("source", flags.source);

    const { data, error } = await query;
    if (error) throw new Error(`Fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as CompanyRow[]));
    if (data.length < PAGE) break;
  }
  return all;
}

// Reject soft-404s where /careers (or careers.x.com) returns 200 but the
// final URL is just the bare domain root — a common pattern when servers
// fall through to the homepage instead of returning a real 404.
function acceptResolvedUrl(domain: string, finalUrl: string): string | null {
  try {
    const u = new URL(finalUrl);
    if (u.pathname === "/" && (u.hostname === domain || u.hostname === `www.${domain}`)) {
      return null;
    }
    return finalUrl;
  } catch {
    return null;
  }
}

// Try one URL. Returns the resolved URL on a 2xx (after soft-404 filter),
// or null on any failure. Some servers don't support HEAD — fall back to a
// GET that caps response body size so we don't pay full-page download cost.
async function probeUrl(domain: string, url: string): Promise<string | null> {
  try {
    const res = await axios.head(url, {
      timeout:        REQUEST_TIMEOUT_MS,
      maxRedirects:   5,
      validateStatus: s => s >= 200 && s < 400,
      headers:        { "User-Agent": USER_AGENT },
    });
    const finalUrl = (res.request?.res?.responseUrl as string | undefined) || url;
    return acceptResolvedUrl(domain, finalUrl);
  } catch (err) {
    const ax = err as AxiosError;
    if (ax.response?.status === 405) {
      try {
        const res = await axios.get(url, {
          timeout:          REQUEST_TIMEOUT_MS,
          maxRedirects:     5,
          maxContentLength: 200_000,
          validateStatus:   s => s >= 200 && s < 400,
          headers:          { "User-Agent": USER_AGENT },
        });
        const finalUrl = (res.request?.res?.responseUrl as string | undefined) || url;
        return acceptResolvedUrl(domain, finalUrl);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function findCareersUrl(domain: string): Promise<string | null> {
  // Root paths first — most common.
  for (const p of CAREERS_PATHS) {
    const hit = await probeUrl(domain, `https://${domain}${p}`);
    if (hit) return hit;
  }
  // Subdomains as a fallback.
  for (const sub of CAREERS_SUBDOMAINS) {
    const hit = await probeUrl(domain, `https://${sub}.${domain}/`);
    if (hit) return hit;
  }
  return null;
}

async function findCareers(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  console.log("\n=== Careers URL Enrichment ===\n");
  if (flags.force)        console.log("  --force enabled (ignoring recheck threshold)");
  if (flags.limit)        console.log(`  --limit=${flags.limit}`);
  if (flags.source)       console.log(`  --source=${flags.source}`);
  console.log(`  --recheck-days=${flags.recheckDays}\n`);

  const allCompanies = await fetchCandidates(flags);
  console.log(`Fetched ${allCompanies.length} candidate companies.`);

  // Filter out recently-checked unless --force
  const recheckCutoff = Date.now() - flags.recheckDays * 24 * 60 * 60 * 1000;
  const todo = flags.force
    ? allCompanies
    : allCompanies.filter(c =>
        !c.careers_checked_at || new Date(c.careers_checked_at).getTime() < recheckCutoff
      );

  const skipped = allCompanies.length - todo.length;
  console.log(`  Skipping ${skipped} checked within last ${flags.recheckDays} days.`);

  const queue = flags.limit ? todo.slice(0, flags.limit) : todo;
  console.log(`  Probing ${queue.length} companies.\n`);

  let found = 0;
  let missed = 0;
  let errors = 0;

  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    const progress = `[${i + 1}/${queue.length}]`;
    try {
      const url = await findCareersUrl(c.website_domain);

      const { error: updateError } = await db
        .from("companies")
        .update({
          careers_url:        url,
          careers_checked_at: new Date().toISOString(),
        })
        .eq("website_domain", c.website_domain);

      if (updateError) {
        console.error(`  ${progress} ✗ DB update failed for ${c.company_name}: ${updateError.message}`);
        errors++;
      } else if (url) {
        console.log(`  ${progress} ✓ ${c.company_name.padEnd(35)} → ${url}`);
        found++;
      } else {
        console.log(`  ${progress} – ${c.company_name.padEnd(35)} (no careers page found)`);
        missed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${progress} ✗ ${c.company_name}: ${msg}`);
      errors++;
    }

    if (i < queue.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_COMPANIES_MS));
    }
  }

  console.log("\n=== Careers Enrichment Complete ===");
  console.log(`  Found:  ${found}`);
  console.log(`  Missed: ${missed}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Hit rate: ${queue.length > 0 ? ((found / queue.length) * 100).toFixed(1) : "0"}%`);
}

findCareers().catch(err => {
  console.error("Enrichment failed:", err);
  process.exit(1);
});
