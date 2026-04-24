import { parse } from "tldts";

export function normalizeDomain(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const withScheme = raw.startsWith("http") ? raw : `https://${raw}`;
    const { domain, publicSuffix } = parse(withScheme);
    if (!domain || !publicSuffix) return null;
    return domain.toLowerCase().trim();
  } catch {
    return null;
  }
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|corp|llc|ltd|co|company|technologies|technology|tech|labs|lab|ai|io)\b\.?/gi, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeInvestors(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map(s => s?.trim())
    .filter(Boolean)
    .map(s => s.toLowerCase());
}
