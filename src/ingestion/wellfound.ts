import { chromium, Page } from "playwright";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { upsertCompanies, Company } from "../lib/db";
import { normalizeDomain, normalizeCompanyName, normalizeInvestors } from "../lib/normalize";
import { classifyStage, SCOPE } from "../config";

// Wellfound startup directory — US filter, sorted by last active
const BASE_URL = "https://wellfound.com/companies";
const MAX_PAGES = 10;         // 10 pages × ~20 companies = ~200 companies per run
const PAGE_DELAY_MS = 3000;   // 3 seconds between pages — do not reduce
const SCROLL_DELAY_MS = 1500;

interface WellfoundCompany {
  name:        string;
  website:     string | null;
  slug:        string;
  description: string | null;
  stage:       string | null;
  tags:        string[];
  location:    string | null;
  teamSize:    string | null;
  jobCount:    number;
  investors:   string[];
  profileUrl:  string;
}

// Not async — nothing to await. The provided template declared this `async`
// with return type `string`, which is a TS error (async must return Promise<T>).
function buildUrl(pageNum: number): string {
  const params = new URLSearchParams({
    filter_by_location_tags: "united-states",
    sorting: "recently_active",
    page: String(pageNum),
  });
  return `${BASE_URL}?${params.toString()}`;
}

async function checkForBotBlock(page: Page): Promise<boolean> {
  const content = await page.content();
  const blockedSignals = [
    "captcha",
    "blocked",
    "access denied",
    "cloudflare",
    "please verify",
    "are you human",
  ];
  return blockedSignals.some(s => content.toLowerCase().includes(s));
}

async function scrapeCompanyList(page: Page, pageNum: number): Promise<WellfoundCompany[]> {
  const url = buildUrl(pageNum);
  console.log(`  → Page ${pageNum}: ${url}`);

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(SCROLL_DELAY_MS);

  // Check for bot detection
  if (await checkForBotBlock(page)) {
    console.error("  ✗ Bot detection triggered. Stopping scraper.");
    return [];
  }

  // Scroll to trigger lazy loading
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) {
      window.scrollBy(0, window.innerHeight);
      await new Promise(r => setTimeout(r, 400));
    }
  });

  await page.waitForTimeout(1000);

  const companies = await page.evaluate(() => {
    interface InlineCompany {
      name:        string;
      website:     string | null;
      slug:        string;
      description: string | null;
      stage:       string | null;
      tags:        string[];
      location:    string | null;
      teamSize:    string | null;
      jobCount:    number;
      investors:   string[];
      profileUrl:  string;
    }
    const results: InlineCompany[] = [];

    // Fallback: find all company profile links
    const profileLinks = Array.from(
      document.querySelectorAll("a[href^='/company/']")
    ) as HTMLAnchorElement[];

    const seen = new Set<string>();

    profileLinks.forEach(link => {
      const card = link.closest("div[class]") || link.parentElement;
      if (!card) return;

      const slug = link.href.replace(/.*\/company\//, "").split("?")[0].split("/")[0];
      if (!slug || seen.has(slug)) return;
      seen.add(slug);

      const name = (
        card.querySelector("h2, h3, [class*='name'], [class*='title']")?.textContent ||
        link.textContent ||
        ""
      ).trim();

      if (!name) return;

      const description = card.querySelector(
        "p, [class*='description'], [class*='tagline']"
      )?.textContent?.trim() || null;

      const tags: string[] = Array.from(
        card.querySelectorAll("[class*='tag'], [class*='badge'], [class*='market']")
      ).map(el => el.textContent?.trim() || "").filter(Boolean);

      const locationText = card.querySelector(
        "[class*='location'], [class*='city']"
      )?.textContent?.trim() || null;

      const teamSize = card.querySelector(
        "[class*='size'], [class*='employees'], [class*='team']"
      )?.textContent?.trim() || null;

      const jobCountText = card.querySelector(
        "[class*='job'], [class*='opening'], [class*='role']"
      )?.textContent?.trim() || "0";
      const jobCount = parseInt(jobCountText.replace(/\D/g, "")) || 0;

      const stage = card.querySelector(
        "[class*='stage'], [class*='funding'], [class*='round']"
      )?.textContent?.trim() || null;

      // External website link
      const websiteLink = card.querySelector(
        "a[href^='http']:not([href*='wellfound']):not([href*='angel.co'])"
      ) as HTMLAnchorElement | null;
      const website = websiteLink?.href || null;

      results.push({
        name,
        website,
        slug,
        description,
        stage,
        tags,
        location: locationText,
        teamSize,
        jobCount,
        investors: [],
        profileUrl: `https://wellfound.com/company/${slug}`,
      });
    });

    return results;
  });

  return companies as WellfoundCompany[];
}

async function scrapeCompanyDetail(page: Page, slug: string): Promise<{
  website:   string | null;
  investors: string[];
  stage:     string | null;
  teamSize:  string | null;
}> {
  try {
    await page.goto(`https://wellfound.com/company/${slug}`, {
      waitUntil: "networkidle",
      timeout: 20000,
    });
    await page.waitForTimeout(1000);

    if (await checkForBotBlock(page)) {
      return { website: null, investors: [], stage: null, teamSize: null };
    }

    return await page.evaluate(() => {
      // Website
      const websiteLink = document.querySelector(
        "a[href^='http']:not([href*='wellfound']):not([href*='angel.co']):not([href*='linkedin']):not([href*='twitter'])"
      ) as HTMLAnchorElement | null;
      const website = websiteLink?.href || null;

      // Investors
      const investorEls = document.querySelectorAll(
        "[class*='investor'] a, [class*='backer'] a, [class*='notable'] a"
      );
      const investors = Array.from(investorEls)
        .map(el => el.textContent?.trim() || "")
        .filter(Boolean);

      // Stage
      const stageEl = document.querySelector(
        "[class*='stage'], [class*='funding-stage'], [data-test*='stage']"
      );
      const stage = stageEl?.textContent?.trim() || null;

      // Team size
      const sizeEl = document.querySelector(
        "[class*='company-size'], [class*='team-size'], [class*='employees']"
      );
      const teamSize = sizeEl?.textContent?.trim() || null;

      return { website, investors, stage, teamSize };
    });
  } catch {
    return { website: null, investors: [], stage: null, teamSize: null };
  }
}

function parseTeamSize(teamSizeStr: string | null): number | null {
  if (!teamSizeStr) return null;
  const match = teamSizeStr.match(/(\d+)/);
  return match ? parseInt(match[1]) : null;
}

function isUSLocation(location: string | null): boolean {
  if (!location) return true; // assume US if not specified
  const usSignals = ["san francisco", "new york", "los angeles", "seattle", "boston",
    "chicago", "austin", "denver", "miami", "remote", "united states", ", ca",
    ", ny", ", tx", ", wa", ", ma", ", il", ", co", ", fl"];
  const loc = location.toLowerCase();
  return usSignals.some(s => loc.includes(s));
}

export async function runWellfoundIngestion(): Promise<void> {
  console.log("\n=== Wellfound Ingestion ===\n");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });

  const page = await context.newPage();

  // Block images and fonts to speed up scraping
  await page.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}", route => route.abort());

  const allCompanies: Company[] = [];
  let totalSkipped = 0;
  const stopped = false;

  try {
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      if (stopped) break;

      console.log(`\nScraping page ${pageNum} of ${MAX_PAGES}...`);
      const raw = await scrapeCompanyList(page, pageNum);

      if (raw.length === 0) {
        console.log("  → No companies found on this page. Stopping.");
        break;
      }

      console.log(`  → Found ${raw.length} companies on page ${pageNum}`);

      for (const company of raw) {
        // Filter to US
        if (!isUSLocation(company.location)) {
          totalSkipped++;
          continue;
        }

        // Get detail page for website + investors if missing
        let website = company.website;
        let investors = company.investors;
        let stage = company.stage;
        let teamSize = company.teamSize;

        if (!website || investors.length === 0) {
          await page.waitForTimeout(1500);
          const detail = await scrapeCompanyDetail(page, company.slug);
          website = website || detail.website;
          investors = investors.length > 0 ? investors : detail.investors;
          stage = stage || detail.stage;
          teamSize = teamSize || detail.teamSize;
        }

        const domain = website ? normalizeDomain(website) : null;
        if (!domain) {
          console.log(`  ✗ Skipped ${company.name} — no valid domain`);
          totalSkipped++;
          continue;
        }

        // Classify stage
        const stageEnum = stage
          ? (stage.toLowerCase().includes("seed")     ? "seed"
          :  stage.toLowerCase().includes("series a") ? "series_a"
          :  stage.toLowerCase().includes("series b") ? "series_b"
          :  stage.toLowerCase().includes("series c") ? "growth"
          :  stage.toLowerCase().includes("growth")   ? "growth"
          :  "unknown")
          : "unknown";

        const headcount = parseTeamSize(teamSize);

        allCompanies.push({
          website_domain:    domain,
          company_name:      company.name,
          stage:             stageEnum,
          tags:              company.tags.slice(0, 10).map(t => t.toLowerCase()),
          geography:         "US",
          funding_total_usd: null,
          last_funding_date: null,
          last_funding_type: stage,
          investors:         normalizeInvestors(investors),
          headcount_current: headcount,
          source:            "wellfound",
          source_priority:   4,
          source_url:        company.profileUrl,
          hotness_score:     Math.min(company.jobCount / 10, 5),
        });

        console.log(`  ✓ ${company.name} (${domain}) — ${stageEnum} — ${company.jobCount} jobs`);
      }

      // Polite delay between pages
      if (pageNum < MAX_PAGES) {
        console.log(`  Waiting ${PAGE_DELAY_MS / 1000}s before next page...`);
        await page.waitForTimeout(PAGE_DELAY_MS);
      }
    }
  } finally {
    await browser.close();
  }

  if (allCompanies.length > 0) {
    console.log(`\nUpserting ${allCompanies.length} companies to Supabase...`);

    // Batch upsert in chunks of 50
    const CHUNK = 50;
    for (let i = 0; i < allCompanies.length; i += CHUNK) {
      const chunk = allCompanies.slice(i, i + CHUNK);
      await upsertCompanies(chunk);
      console.log(`  → Upserted chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(allCompanies.length / CHUNK)}`);
    }
  }

  console.log(`\n=== Wellfound Ingestion Complete ===`);
  console.log(`  Upserted: ${allCompanies.length}`);
  console.log(`  Skipped:  ${totalSkipped}`);
}
