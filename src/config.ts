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

export function classifyStage(fundingUSD: number | null): FundingStage {
  if (fundingUSD === null || fundingUSD < 0) return "unknown";
  for (const [stage, [min, max]] of Object.entries(STAGE_THRESHOLDS) as [FundingStage, [number, number]][]) {
    if (stage === "unknown") continue;
    if (fundingUSD >= min && fundingUSD <= max) return stage;
  }
  return "unknown";
}
