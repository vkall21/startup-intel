import { chromium } from "playwright";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { upsertCompanies, Company } from "../lib/db";
import { normalizeDomain, normalizeCompanyName, normalizeInvestors } from "../lib/normalize";
import { classifyStage, SCOPE } from "../config";

const TC_FUNDING_URL = "https://techcrunch.com/tag/funding/";
const MAX_ARTICLES = 40;
const SCROLL_DELAY_MS = 1500;

interface RawArticle {
  title: string;
  url: string;
  date: string;
  excerpt: string;
}

async function scrapeArticleList(): Promise<RawArticle[]> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  });

  console.log("  → Opening TechCrunch funding page...");
  await page.goto(TC_FUNDING_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(SCROLL_DELAY_MS);

  // Scroll to load more articles
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(SCROLL_DELAY_MS);
  }

  const articles = await page.evaluate(() => {
    const items: { title: string; url: string; date: string; excerpt: string }[] = [];

    // TechCrunch article card selectors (try multiple patterns for resilience)
    const cards = document.querySelectorAll([
      "article.post-block",
      "div.post-block",
      "li.wp-block-post",
      "article[class*='post']"
    ].join(", "));

    cards.forEach((card: Element) => {
      const titleEl = card.querySelector("h2 a, h3 a, .post-block__title a, a.post-block__title__link");
      const dateEl  = card.querySelector("time, .post-block__meta time");
      const excerptEl = card.querySelector(".post-block__content, p");

      if (!titleEl) return;

      items.push({
        title:   titleEl.textContent?.trim() || "",
        url:     titleEl.getAttribute("href") || "",
        date:    dateEl?.getAttribute("datetime") || dateEl?.textContent?.trim() || "",
        excerpt: excerptEl?.textContent?.trim() || "",
      });
    });

    return items;
  });

  await browser.close();
  return articles.slice(0, MAX_ARTICLES);
}

async function scrapeArticleDetail(articleUrl: string): Promise<{
  companyName: string | null;
  website: string | null;
  fundingAmount: number | null;
  fundingType: string | null;
  investors: string[];
}> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setExtraHTTPHeaders({
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
  });

  try {
    await page.goto(articleUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(800);

    const content = await page.evaluate(() => {
      const body = document.querySelector(".entry-content, .wp-block-post-content, article, main");
      return body?.textContent || document.body.textContent || "";
    });

    // Extract funding amount (e.g. "$10M", "$1.5 billion", "$500K")
    const amountMatch = content.match(/\$(\d+(?:\.\d+)?)\s*(million|billion|M|B|K)\b/i);
    let fundingAmount: number | null = null;
    if (amountMatch) {
      const num = parseFloat(amountMatch[1]);
      const unit = amountMatch[2].toLowerCase();
      if (unit === "billion" || unit === "b") fundingAmount = Math.round(num * 1_000_000_000);
      else if (unit === "million" || unit === "m") fundingAmount = Math.round(num * 1_000_000);
      else if (unit === "k") fundingAmount = Math.round(num * 1_000);
    }

    // Extract funding type
    const typeMatch = content.match(/\b(pre-seed|seed|series [a-f]|growth|pre-ipo|venture|angel)\b/i);
    const fundingType = typeMatch ? typeMatch[1] : null;

    // Extract company website links from article body
    const links = await page.evaluate(() => {
      const SOCIAL = /(techcrunch\.com|twitter\.com|x\.com|facebook\.com|linkedin\.com|instagram\.com|youtube\.com|threads\.net|mstdn\.social|crunchboard\.com|strictlyvc\.com|wordpress\.com|medium\.com|t\.co|bit\.ly|wp\.me|feeds\.|rss|bloomberg\.com|reuters\.com|wsj\.com|cnbc\.com|ft\.com|nytimes\.com|yahoo\.com|forbes\.com|businessinsider\.com|theinformation\.com|axios\.com|arstechnica\.com|theverge\.com|wired\.com|venturebeat\.com|protocol\.com|digitimes\.com|marketsandmarkets\.com|cnn\.com|bbc\.com|bbc\.co\.uk|apple\.com\/newsroom|google\.com|microsoft\.com|amazon\.com|wikipedia\.org|github\.com|gov\.uk|\.gov|flickr\.com|gettyimages)/i;
      const anchors = Array.from(document.querySelectorAll(".entry-content a, .wp-block-post-content a, article a"));
      return anchors
        .map((a: Element) => a.getAttribute("href") || "")
        .filter((href: string) => href.startsWith("http") && !SOCIAL.test(href));
    });

    const website = links[0] || null;

    // Extract company name from title (first capitalized word/phrase before "raises" or "secures")
    const titleOnPage = await page.title();
    const nameMatch = titleOnPage.match(/^([^,|–-]+?)\s+(?:raises|secures|closes|lands|gets|announces)/i);
    const companyName = nameMatch ? nameMatch[1].trim() : null;

    // Basic investor extraction ("led by X", "with participation from Y")
    const investorMatch = content.match(/led by ([^,.]+)/i);
    const investors = investorMatch
      ? investorMatch[1].split(/and|,/).map((s: string) => s.trim()).filter(Boolean)
      : [];

    return { companyName, website, fundingAmount, fundingType, investors };
  } catch {
    return { companyName: null, website: null, fundingAmount: null, fundingType: null, investors: [] };
  } finally {
    await browser.close();
  }
}

export async function runTechCrunchIngestion(): Promise<void> {
  console.log("\n=== TechCrunch Ingestion ===\n");

  console.log("Scraping article list...");
  const articles = await scrapeArticleList();
  console.log(`  → Found ${articles.length} articles\n`);

  const companies: Company[] = [];
  let skipped = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    console.log(`  [${i + 1}/${articles.length}] ${article.title.slice(0, 60)}...`);

    const detail = await scrapeArticleDetail(article.url);

    if (!detail.website && !detail.companyName) {
      console.log("    ✗ Skipped — no company data extracted");
      skipped++;
      continue;
    }

    const domain = detail.website ? normalizeDomain(detail.website) : null;
    const name = detail.companyName
      ? detail.companyName
      : domain || "unknown";

    if (!domain) {
      console.log(`    ✗ Skipped — could not normalize domain for: ${detail.website}`);
      skipped++;
      continue;
    }

    const stage = classifyStage(detail.fundingAmount);

    companies.push({
      website_domain:     domain,
      company_name:       name,
      stage,
      funding_total_usd:  detail.fundingAmount,
      last_funding_date:  article.date ? new Date(article.date).toISOString().split("T")[0] : null,
      last_funding_type:  detail.fundingType,
      investors:          normalizeInvestors(detail.investors),
      source:             "techcrunch",
      source_priority:    5,
      source_url:         article.url,
      geography:          "US",
    });

    console.log(`    ✓ ${name} (${domain}) — ${stage} — $${detail.fundingAmount?.toLocaleString() ?? "unknown"}`);

    // Polite delay between article requests
    await new Promise(r => setTimeout(r, 1000));
  }

  // Deduplicate by website_domain (keep first occurrence) — Postgres ON CONFLICT
  // can't affect the same row twice in one statement.
  const seen = new Set<string>();
  const deduped = companies.filter(c => {
    if (seen.has(c.website_domain)) return false;
    seen.add(c.website_domain);
    return true;
  });
  const duplicates = companies.length - deduped.length;

  if (deduped.length > 0) {
    console.log(`\nUpserting ${deduped.length} companies to Supabase${duplicates ? ` (${duplicates} duplicates dropped)` : ""}...`);
    await upsertCompanies(deduped);
    console.log("  ✓ Done");
  }

  console.log(`\nTechCrunch ingestion complete.`);
  console.log(`  Upserted: ${companies.length}`);
  console.log(`  Skipped:  ${skipped}`);
}
