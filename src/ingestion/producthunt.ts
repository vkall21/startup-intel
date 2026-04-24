import axios from "axios";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { upsertCompanies, Company } from "../lib/db";
import { normalizeDomain } from "../lib/normalize";
import { classifyStage } from "../config";

const PH_ENDPOINT = "https://api.producthunt.com/v2/api/graphql";
const MIN_UPVOTES = 50;
const MAX_POSTS = 100;

interface PHPost {
  name: string;
  tagline: string;
  website: string;
  votesCount: number;
  createdAt: string;
  url: string;
  topics: { edges: { node: { name: string } }[] };
  maker?: { name: string };
}

async function fetchRecentPosts(daysBack: number = 30): Promise<PHPost[]> {
  const token = process.env.PRODUCT_HUNT_TOKEN;
  if (!token || token === "your_token_here") {
    throw new Error("PRODUCT_HUNT_TOKEN is not set in .env.local");
  }

  const postedAfter = new Date();
  postedAfter.setDate(postedAfter.getDate() - daysBack);

  const query = `
    query GetPosts($postedAfter: DateTime!, $after: String) {
      posts(
        order: VOTES
        postedAfter: $postedAfter
        after: $after
        first: 20
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            name
            tagline
            website
            votesCount
            createdAt
            url
            topics {
              edges {
                node { name }
              }
            }
          }
        }
      }
    }
  `;

  const allPosts: PHPost[] = [];
  let cursor: string | null = null;
  let page = 1;

  while (allPosts.length < MAX_POSTS) {
    console.log(`  → Fetching page ${page}...`);

    interface PHResponse {
      data?: {
        posts: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: { node: PHPost }[];
        };
      };
      errors?: unknown;
    }

    const raw = await axios.post(
      PH_ENDPOINT,
      { query, variables: { postedAfter: postedAfter.toISOString(), after: cursor } },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 15000,
      }
    );

    const body = raw.data as PHResponse;

    if (body.errors) {
      throw new Error(`Product Hunt API error: ${JSON.stringify(body.errors)}`);
    }
    if (!body.data) {
      throw new Error(`Product Hunt API returned no data: ${JSON.stringify(body)}`);
    }

    const { edges, pageInfo }: { edges: { node: PHPost }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } = body.data.posts;
    const posts = edges.map((e: { node: PHPost }) => e.node);
    allPosts.push(...posts);

    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
    page++;

    // Rate limit: 1 request/second
    await new Promise(r => setTimeout(r, 1000));
  }

  return allPosts.filter(p => p.votesCount >= MIN_UPVOTES);
}

// Product Hunt returns tracking-redirect URLs (producthunt.com/r/...) in `website`.
// Follow the redirects to get the real company URL before normalizing.
async function resolveFinalUrl(url: string): Promise<string> {
  try {
    const res = await axios.get(url, {
      maxRedirects: 10,
      timeout: 10000,
      validateStatus: () => true,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const req = res.request as { res?: { responseUrl?: string } } | undefined;
    return req?.res?.responseUrl || url;
  } catch {
    return url;
  }
}

export async function runProductHuntIngestion(): Promise<void> {
  console.log("\n=== Product Hunt Ingestion ===\n");

  console.log("Fetching recent posts (last 30 days, min 50 upvotes)...");
  const posts = await fetchRecentPosts(30);
  console.log(`  → ${posts.length} posts meet threshold\n`);

  const companies: Company[] = [];
  const seenDomains = new Set<string>();
  let skipped = 0;

  for (const post of posts) {
    const finalUrl = await resolveFinalUrl(post.website);
    const domain = normalizeDomain(finalUrl);
    if (!domain || domain === "producthunt.com") {
      console.log(`  ✗ Skipped ${post.name} — invalid domain: ${finalUrl}`);
      skipped++;
      continue;
    }
    if (seenDomains.has(domain)) {
      console.log(`  ~ Duplicate ${post.name} (${domain}) — already in batch`);
      skipped++;
      continue;
    }
    seenDomains.add(domain);

    const tags = post.topics.edges.map(e => e.node.name.toLowerCase());

    // Do NOT set stage here — Product Hunt carries no funding-stage signal.
    // Let the DB default ('unknown') apply to new rows; existing rows keep
    // whatever the Phase 4 classifier assigned.
    companies.push({
      website_domain:    domain,
      company_name:      post.name,
      funding_total_usd: null,
      last_funding_date: null,
      tags,
      geography:         "US",
      source:            "producthunt",
      source_priority:   5,
      source_url:        post.url,
      hotness_score:     Math.min(post.votesCount / 100, 10),
    });

    console.log(`  ✓ ${post.name} (${domain}) — ${post.votesCount} upvotes — [${tags.slice(0,3).join(", ")}]`);
  }

  if (companies.length > 0) {
    console.log(`\nUpserting ${companies.length} companies to Supabase...`);
    await upsertCompanies(companies);
    console.log("  ✓ Done");
  }

  console.log(`\nProduct Hunt ingestion complete.`);
  console.log(`  Upserted: ${companies.length}`);
  console.log(`  Skipped:  ${skipped}`);
}
