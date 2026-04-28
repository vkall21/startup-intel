"use client";

export type Filters = {
  q:          string;
  stage:      string;
  geography:  string;
  source:     string;
  tag:        string;
  minHotness: number;
  hasCareers: boolean;
  sort:       "hotness_score" | "last_funding_date" | "company_name";
};

const STAGES = [
  { value: "",         label: "All stages" },
  { value: "pre_seed", label: "Pre-seed" },
  { value: "seed",     label: "Seed" },
  { value: "series_a", label: "Series A" },
  { value: "series_b", label: "Series B" },
  { value: "growth",   label: "Growth" },
  { value: "pre_ipo",  label: "Pre-IPO" },
  { value: "unknown",  label: "Unknown" },
];

const GEOS = [
  { value: "",   label: "All regions" },
  { value: "US", label: "United States" },
  { value: "EU", label: "Europe" },
];

const SOURCES = [
  { value: "",            label: "All sources" },
  { value: "techcrunch",  label: "TechCrunch" },
  { value: "producthunt", label: "Product Hunt" },
  { value: "wellfound",   label: "Wellfound" },
  { value: "yc",          label: "YC" },
];

const SORTS = [
  { value: "hotness_score",     label: "Hotness" },
  { value: "last_funding_date", label: "Latest funding" },
  { value: "company_name",      label: "Name A–Z" },
];

interface FilterBarProps {
  filters:   Filters;
  onChange:  (filters: Filters) => void;
  total:     number;
  filtered:  number;
}

export default function FilterBar({ filters, onChange, total, filtered }: FilterBarProps) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const selectClass = "text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-3">

      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          placeholder="Search companies…"
          value={filters.q}
          onChange={e => set({ q: e.target.value })}
          className="w-full text-sm border border-gray-200 rounded-lg pl-9 pr-3 py-2 bg-white text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">

      {/* Stage */}
      <select
        className={selectClass}
        value={filters.stage}
        onChange={e => set({ stage: e.target.value })}
      >
        {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>

      {/* Geography */}
      <select
        className={selectClass}
        value={filters.geography}
        onChange={e => set({ geography: e.target.value })}
      >
        {GEOS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
      </select>

      {/* Source */}
      <select
        className={selectClass}
        value={filters.source}
        onChange={e => set({ source: e.target.value })}
      >
        {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>

      {/* Min hotness */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Min hotness</span>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={filters.minHotness}
          onChange={e => set({ minHotness: parseFloat(e.target.value) })}
          className="w-24 accent-blue-500"
        />
        <span className="text-sm text-gray-700 w-6">{filters.minHotness}</span>
      </div>

      {/* Has careers page */}
      <button
        type="button"
        onClick={() => set({ hasCareers: !filters.hasCareers })}
        className={`text-sm px-3 py-2 rounded-lg border transition-all ${
          filters.hasCareers
            ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-medium"
            : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"
        }`}
      >
        Hiring
      </button>

      {/* Sort */}
      <div className="flex items-center gap-2 ml-auto">
        <span className="text-sm text-gray-500">Sort</span>
        <select
          className={selectClass}
          value={filters.sort}
          onChange={e => set({ sort: e.target.value as Filters["sort"] })}
        >
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Count */}
      <span className="text-xs text-gray-400 shrink-0">
        {filtered} of {total}
      </span>
      </div>
    </div>
  );
}
