"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase, Company } from "@/lib/supabase";
import CompanyCard from "@/components/CompanyCard";
import FilterBar, { Filters } from "@/components/FilterBar";

const DEFAULT_FILTERS: Filters = {
  q:          "",
  stage:      "",
  geography:  "",
  source:     "",
  tag:        "",
  minHotness: 0,
  hasCareers: false,
  sort:       "hotness_score",
};

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function Dashboard() {
  const [companies,       setCompanies]       = useState<Company[]>([]);
  const [total,           setTotal]           = useState(0);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [filters,         setFilters]         = useState<Filters>(DEFAULT_FILTERS);
  const [appliedFilters,  setAppliedFilters]  = useState<Filters>(DEFAULT_FILTERS);
  const [page,            setPage]            = useState(0);
  const [pageSize,        setPageSize]        = useState(25);

  const fetchCompanies = useCallback(async (activeFilters: Filters, pageNum: number, size: number) => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("companies")
        .select("*", { count: "exact" });

      if (activeFilters.q)
        query = query.ilike("company_name", `%${activeFilters.q}%`);
      if (activeFilters.stage)
        query = query.eq("stage", activeFilters.stage);
      if (activeFilters.geography)
        query = query.eq("geography", activeFilters.geography);
      if (activeFilters.source)
        query = query.eq("source", activeFilters.source);
      if (activeFilters.tag)
        query = query.contains("tags", [activeFilters.tag]);
      if (activeFilters.minHotness > 0)
        query = query.gte("hotness_score", activeFilters.minHotness);
      if (activeFilters.hasCareers)
        query = query.not("careers_url", "is", null);

      const ascending = activeFilters.sort === "company_name";
      query = query.order(activeFilters.sort, { ascending });

      const from = pageNum * size;
      query = query.range(from, from + size - 1);

      const { data, count, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      setTotal(count || 0);
      setCompanies(data || []);

    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch companies");
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce filter changes (~300ms) so we don't fire a Supabase query per keystroke
  useEffect(() => {
    const t = setTimeout(() => setAppliedFilters(filters), 300);
    return () => clearTimeout(t);
  }, [filters]);

  // Refetch when applied filters or page size change — reset to page 0
  useEffect(() => {
    setPage(0);
    fetchCompanies(appliedFilters, 0, pageSize);
  }, [appliedFilters, pageSize, fetchCompanies]);

  const goToPage = (n: number) => {
    setPage(n);
    fetchCompanies(appliedFilters, n, pageSize);
    // Scroll to top so users see the new page from row 1
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleFilterChange = (newFilters: Filters) => {
    setFilters(newFilters);
  };

  const totalPages  = Math.max(1, Math.ceil(total / pageSize));
  const showingFrom = total === 0 ? 0 : page * pageSize + 1;
  const showingTo   = Math.min(total, page * pageSize + companies.length);

  // Smart truncation: 1 2 3 4 5 … last  / first … N-1 N N+1 … last
  const pageNumbers = ((): (number | "...")[] => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
    if (page < 4) return [0, 1, 2, 3, 4, "...", totalPages - 1];
    if (page >= totalPages - 4)
      return [0, "...", totalPages - 5, totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1];
    return [0, "...", page - 1, page, page + 1, "...", totalPages - 1];
  })();

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Startup Intel</h1>
            <p className="text-xs text-gray-400">Live startup tracker</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded-full">
              {total} companies
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-5">

        {/* Filters */}
        <FilterBar
          filters={filters}
          onChange={handleFilterChange}
          total={total}
          filtered={companies.length}
        />

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && companies.length === 0 && !error && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">No companies match your filters</p>
            <button
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="mt-3 text-sm text-blue-500 hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {companies.map(company => (
            <CompanyCard key={company.website_domain} company={company} />
          ))}

          {/* Loading skeletons */}
          {loading && Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3 animate-pulse"
            >
              <div className="h-4 bg-gray-100 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-1/2" />
              <div className="h-2 bg-gray-100 rounded w-full mt-2" />
              <div className="flex gap-1 mt-1">
                <div className="h-5 bg-gray-100 rounded-full w-16" />
                <div className="h-5 bg-gray-100 rounded-full w-12" />
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {!loading && companies.length > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3 pt-4 border-t border-gray-100">

            {/* Showing X–Y of Z */}
            <span className="text-xs text-gray-500">
              Showing {showingFrom}–{showingTo} of {total}
            </span>

            {/* Page nav */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page === 0}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Prev
              </button>

              {pageNumbers.map((n, i) =>
                n === "..." ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-sm text-gray-400 select-none">…</span>
                ) : (
                  <button
                    key={n}
                    onClick={() => goToPage(n)}
                    className={`min-w-[2rem] px-2 py-1.5 rounded-lg text-sm border transition-all ${
                      n === page
                        ? "bg-blue-50 border-blue-200 text-blue-700 font-medium"
                        : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {n + 1}
                  </button>
                )
              )}

              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages - 1}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Next
              </button>
            </div>

            {/* Page size selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Per page</span>
              <select
                value={pageSize}
                onChange={e => setPageSize(parseInt(e.target.value, 10))}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
