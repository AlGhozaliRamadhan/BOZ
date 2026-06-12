'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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
