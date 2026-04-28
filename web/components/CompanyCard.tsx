import { Company } from "@/lib/supabase";

const STAGE_COLORS: Record<string, string> = {
  pre_seed: "bg-purple-100 text-purple-800",
  seed:     "bg-blue-100 text-blue-800",
  series_a: "bg-teal-100 text-teal-800",
  series_b: "bg-green-100 text-green-800",
  growth:   "bg-amber-100 text-amber-800",
  pre_ipo:  "bg-orange-100 text-orange-800",
  unknown:  "bg-gray-100 text-gray-500",
};

function formatFunding(amount: number | null): string {
  if (!amount) return "Undisclosed";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000)     return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000)         return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    year:  "numeric",
  });
}

function HotnessBar({ score }: { score: number }) {
  const pct   = Math.min((score / 10) * 100, 100);
  const color = score >= 7 ? "bg-red-500"
              : score >= 4 ? "bg-amber-500"
              : "bg-blue-400";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-6 text-right">{score.toFixed(1)}</span>
    </div>
  );
}

export default function CompanyCard({ company }: { company: Company }) {
  const stageColor = STAGE_COLORS[company.stage] || STAGE_COLORS.unknown;
  const stageLabel = company.stage.replace(/_/g, " ");

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 hover:border-gray-300 hover:shadow-sm transition-all duration-200 flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 truncate text-sm">
            {company.company_name}
          </h3>
          <a
            href={`https://${company.website_domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-blue-500 transition-colors truncate block"
          >
            {company.website_domain}
          </a>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 capitalize ${stageColor}`}>
          {stageLabel}
        </span>
      </div>

      {/* Funding */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span className="font-medium text-gray-700">
          {formatFunding(company.funding_total_usd)}
        </span>
        {company.last_funding_date && (
          <span>{formatDate(company.last_funding_date)}</span>
        )}
      </div>

      {/* Hotness */}
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Hotness</span>
        </div>
        <HotnessBar score={company.hotness_score || 0} />
      </div>

      {/* Tags */}
      {company.tags && company.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {company.tags.slice(0, 4).map(tag => (
            <span
              key={tag}
              className="text-xs bg-gray-50 text-gray-500 border border-gray-100 px-2 py-0.5 rounded-full capitalize"
            >
              {tag}
            </span>
          ))}
          {company.tags.length > 4 && (
            <span className="text-xs text-gray-400">+{company.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-50">
        <span className="text-xs text-gray-300 capitalize">{company.source}</span>
        <div className="flex items-center gap-3">
          {company.careers_url && (
            <a
              href={company.careers_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-emerald-600 hover:text-emerald-700 transition-colors font-medium"
            >
              Careers →
            </a>
          )}
          {company.source_url && (
            <a
              href={company.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-blue-500 transition-colors"
            >
              Source →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
