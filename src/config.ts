// SCOPE — locked before any ingestion code is written.
// Every downstream module (ingestion, dedupe, scoring) must read from here.
// Prevents scope creep from leaking into every module later.
export const SCOPE = {
  geographies: ["US", "EU"],
  fundingTypes: ["venture", "angel", "seed"],
  minFundingUSD: 0,
  maxAgeDays: 5 * 365,        // 5-year lookback
  bootstrappedIncluded: false,
} as const;

export type FundingStage =
  | "pre_seed"
  | "seed"
  | "series_a"
  | "series_b"
  | "growth"
  | "pre_ipo"
  | "unknown";

export const STAGE_THRESHOLDS: Record<FundingStage, [number, number]> = {
  pre_seed: [0,           500_000],
  seed:     [500_001,     5_000_000],
  series_a: [5_000_001,   30_000_000],
  series_b: [30_000_001,  100_000_000],
  growth:   [100_000_001, 500_000_000],
  pre_ipo:  [500_000_001, Infinity],
  unknown:  [-1, -1],
};

// YC's Algolia index stores `batch` as long-form strings ("Winter 2023"),
// not the W23 codes used elsewhere. Match exactly — this list drives the
// facetFilters query.
export const YC_BATCHES = [
  "Winter 2021", "Summer 2021",
  "Winter 2022", "Summer 2022",
  "Winter 2023", "Summer 2023",
  "Winter 2024", "Summer 2024", "Fall 2024",
  "Winter 2025", "Spring 2025", "Summer 2025", "Fall 2025",
  "Winter 2026", "Spring 2026", "Summer 2026",
] as const;

export function classifyStage(fundingUSD: number | null): FundingStage {
  if (fundingUSD === null || fundingUSD < 0) return "unknown";
  for (const [stage, [min, max]] of Object.entries(STAGE_THRESHOLDS) as [FundingStage, [number, number]][]) {
    if (stage === "unknown") continue;
    if (fundingUSD >= min && fundingUSD <= max) return stage;
  }
  return "unknown";
}
