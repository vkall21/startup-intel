"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase, Company } from "@/lib/supabase";
import CompanyCard from "@/components/CompanyCard";
import FilterBar, { Filters } from "@/components/FilterBar";

const DEFAULT_FILTERS: Filters = {
  stage:      "",
  geography:  "",
  tag:        "",
  minHotness: 0,
  sort:       "hotness_score",
};

const PAGE_SIZE = 24;

export default function Dashboard() {
  const [companies,  setCompanies]  = useState<Company[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [filters,    setFilters]    = useState<Filters>(DEFAULT_FILTERS);
  const [page,       setPage]       = useState(0);
  const [hasMore,    setHasMore]    = useState(true);

  const fetchCompanies = useCallback(async (activeFilters: Filters, pageNum: number, append: boolean) => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from("companies")
        .select("*", { count: "exact" });

      // Apply filters
      if (activeFilters.stage)
        query = query.eq("stage", activeFilters.stage);
      if (activeFilters.geography)
        query = query.eq("geography", activeFilters.geography);
      if (activeFilters.tag)
        query = query.contains("tags", [activeFilters.tag]);
      if (activeFilters.minHotness > 0)
        query = query.gte("hotness_score", activeFilters.minHotness);

      // Sort
      const ascending = activeFilters.sort === "company_name";
      query = query.order(activeFilters.sort, { ascending });

      // Pagination
      const from = pageNum * PAGE_SIZE;
      query = query.range(from, from + PAGE_SIZE - 1);

      const { data, count, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      setTotal(count || 0);
      setCompanies(prev => append ? [...prev, ...(data || [])] : (data || []));
      setHasMore((data || []).length === PAGE_SIZE);

    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch companies");
    } finally {
      setLoading(false);
    }
  }, []);

  // Refetch when filters change
  useEffect(() => {
    setPage(0);
    fetchCompanies(filters, 0, false);
  }, [filters, fetchCompanies]);

  // Load more
  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    fetchCompanies(filters, next, true);
  };

  const handleFilterChange = (newFilters: Filters) => {
    setFilters(newFilters);
  };

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

        {/* Load more */}
        {hasMore && !loading && companies.length > 0 && (
          <div className="flex justify-center pt-4">
            <button
              onClick={loadMore}
              className="px-6 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-all"
            >
              Load more
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
