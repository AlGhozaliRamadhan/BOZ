'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { RefObject } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════════
   useSymbolSearch — paged symbol search shared by Discover, the ticker page and
   the chat composer.

   The old picker pattern fetched once and kept a fixed top-N, so the list just
   stopped. This one debounces the keystroke, requests one page at a time, and
   appends later pages on demand — nothing is pre-truncated.
   ═══════════════════════════════════════════════════════════════════════════════ */

export interface SymbolSearchItem {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  market: string;
  source: string;
}

interface SymbolSearchResponse {
  results?: SymbolSearchItem[];
  total?: number;
  hasMore?: boolean;
}

interface UseSymbolSearchOptions {
  /** Gate the search off entirely (e.g. the dropdown is closed). */
  enabled?: boolean;
  pageSize?: number;
}

interface UseSymbolSearchResult {
  results: SymbolSearchItem[];
  isSearching: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  total: number;
  error: string | null;
  loadMore: () => void;
  reset: () => void;
}

const SYMBOL_SEARCH_DEBOUNCE_MS = 300;
const SYMBOL_SEARCH_PAGE_SIZE = 8;

export function useSymbolSearch(
  rawQuery: string,
  options: UseSymbolSearchOptions = {},
): UseSymbolSearchResult {
  const { enabled = true, pageSize = SYMBOL_SEARCH_PAGE_SIZE } = options;
  const query = rawQuery.trim();

  const [results, setResults] = useState<SymbolSearchItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(0);

  const run = useCallback(
    async (offset: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (offset === 0) setIsSearching(true);
      else setIsLoadingMore(true);

      try {
        const params = new URLSearchParams({
          q: query,
          limit: String(pageSize),
          offset: String(offset),
        });
        const res = await fetch(`/api/market/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Search failed (${res.status})`);

        const data = (await res.json()) as SymbolSearchResponse;
        if (controller.signal.aborted) return;

        const page = Array.isArray(data?.results) ? data.results : [];
        loadedRef.current = offset + page.length;
        setTotal(typeof data?.total === 'number' ? data.total : page.length);
        setHasMore(data?.hasMore === true);
        setResults(prev => (offset === 0 ? page : [...prev, ...page]));
        setError(null);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (offset === 0) {
          loadedRef.current = 0;
          setResults([]);
          setHasMore(false);
        }
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
          setIsLoadingMore(false);
        }
      }
    },
    [query, pageSize],
  );

  useEffect(() => {
    loadedRef.current = 0;

    if (!enabled || !query) {
      abortRef.current?.abort();
      setResults([]);
      setHasMore(false);
      setTotal(0);
      setIsSearching(false);
      setIsLoadingMore(false);
      return;
    }

    const timer = setTimeout(() => {
      void run(0);
    }, SYMBOL_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, enabled, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadMore = useCallback(() => {
    if (isSearching || isLoadingMore || !hasMore) return;
    void run(loadedRef.current);
  }, [hasMore, isSearching, isLoadingMore, run]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    loadedRef.current = 0;
    setResults([]);
    setHasMore(false);
    setTotal(0);
    setError(null);
  }, []);

  return { results, isSearching, isLoadingMore, hasMore, total, error, loadMore, reset };
}

/**
 * Calls `onLoadMore` when the returned sentinel scrolls into view, so a result
 * list keeps filling as the user scrolls instead of stopping at the first page.
 */
export function useLoadMoreOnScroll(
  hasMore: boolean,
  isLoading: boolean,
  onLoadMore: () => void,
): RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const callbackRef = useRef(onLoadMore);
  callbackRef.current = onLoadMore;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || isLoading || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) callbackRef.current();
      },
      { rootMargin: '140px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoading]);

  return sentinelRef;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   useFetch — generic fetch hook
   ═══════════════════════════════════════════════════════════════════════════════ */

interface UseFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useFetch<T>(url: string, options?: RequestInit): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!url) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Request failed: ${res.status} ${res.statusText}`);
      }

      const json = (await res.json()) as T;
      setData(json);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, [url, options]);

  useEffect(() => {
    fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   useMarketData — fetch market quote for a ticker
   ═══════════════════════════════════════════════════════════════════════════════ */

interface MarketQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  timestamp: string;
}

interface UseMarketDataResult {
  data: MarketQuote | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useMarketData(ticker: string): UseMarketDataResult {
  const url = ticker ? `/api/market/quote?ticker=${encodeURIComponent(ticker)}` : '';
  const { data, loading, error, refetch } = useFetch<MarketQuote>(url);
  return { data, loading, error, refresh: refetch };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   useAnalysis — trigger and fetch analysis results
   ═══════════════════════════════════════════════════════════════════════════════ */

interface AnalysisResult {
  prediction: 'UP' | 'DOWN' | 'UNKNOWN';
  confidence: number;
  strategy: string;
  entry: string;
  target: string;
  stop: string;
  reasons: string[];
  timestamp: string;
}

interface UseAnalysisResult {
  data: AnalysisResult | null;
  loading: boolean;
  error: string | null;
  run: () => void;
}

export function useAnalysis(
  type: 'intraday' | 'longterm',
  ticker: string,
): UseAnalysisResult {
  const [data, setData] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (!ticker) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/analyze/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Analysis failed: ${res.status} ${res.statusText}`);
      }

      const json = (await res.json()) as AnalysisResult;
      setData(json);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setLoading(false);
    }
  }, [type, ticker]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return { data, loading, error, run };
}
