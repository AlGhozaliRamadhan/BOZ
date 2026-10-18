import { ChartAnalyzer } from '../../analyzers/chart.analyzer.js';
import { buildDashboardAnalysis, type QuoteSnapshot } from '../../shared/dashboard-analysis.js';
import { buildExpertSignal } from '../../shared/expert-signal.js';
import { scoreScreenerPreset } from '../../shared/screener-scoring.js';
import type {
  ScreenerDirection,
  ScreenerMode,
  ScreenerPreset,
  ScreenerResult,
} from '../../shared/screener-contract.js';
import { MAX_SCAN_RESULTS } from '../../shared/screener-contract.js';
import type { Candle } from '../../types/types.js';
import { log } from '../../utils/logger.js';
import { deepScanWorkloadGate, WorkloadBusyError } from '../security/workload-gate.js';
import { IndicatorsService } from './indicators.service.js';
import { idxUniverseService } from './idx.universe.service.js';
import { globalUniverseService } from './global.universe.service.js';
import { yahooFinance } from './yahoo.service.js';

export type ScanSignal = 'BUY' | 'WATCH' | 'AVOID';
export type SignalFilter = ScreenerDirection;
export type SetupFilter = ScreenerPreset | 'all_time_low';
export type ScanMode = ScreenerMode;
export type ScannerUniverse = 'idx' | 'us' | 'crypto' | 'global';

/** 'global' is a deprecated alias for 'us' kept for older clients. */
export function normalizeScannerUniverse(value: ScannerUniverse | string): 'idx' | 'us' | 'crypto' {
  if (value === 'crypto') return 'crypto';
  if (value === 'us' || value === 'global') return 'us';
  return 'idx';
}
export type IdxSector =
  | 'all' | 'banking' | 'consumer' | 'mining' | 'energy'
  | 'tech' | 'property' | 'telecom' | 'healthcare' | 'industrial';

export interface StockEntry {
  ticker: string;
  name: string;
  sector: string;
}

/** Compatibility shape retained for the chat tool and older API consumers. */
export interface StockResult extends ScreenerResult {
  price: number;
  chg1d: number;
  chg5d: number;
  chg20d: number;
  volRatio: number;
  from52wHigh: number;
  from52wLow: number;
  rsi: number | null;
  macdSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  signal: ScanSignal;
  reason: string;
  setupType: ScreenerPreset | 'none';
}

export interface ScanResult {
  sector: string;
  preset: ScreenerPreset;
  signalFilter: SignalFilter;
  universe: ScannerUniverse;
  mode: ScanMode;
  startedAt: string;
  completedAt: string;
  universeCount: number;
  candidateCount: number;
  totalScanned: number;
  buyCount: number;
  sellCount: number;
  watchCount: number;
  avoidCount: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  avgScore: number;
  breadthSignal: string;
  partial: boolean;
  cacheHit: boolean;
  results: StockResult[];
  buys: StockResult[];
  watches: StockResult[];
  avoids: StockResult[];
  skipped: string[];
  formatted: string;
}

interface QuotedEntry extends StockEntry {
  quote: any;
}

interface QuoteCandidate extends QuotedEntry {
  preScore: number;
  /** Which lens queued this candidate, so a board can report it. */
  preset: ScreenerPreset;
}

export interface ScanOptions {
  minimumConviction?: 'LOW' | 'MEDIUM' | 'HIGH';
  signal?: AbortSignal;
  universe?: ScannerUniverse;
}

/** One page of a scan. `hasMore` drives the pager; nothing is pre-enriched. */
export interface ScanPage {
  sector: string;
  presets: ScreenerPreset[];
  signalFilter: SignalFilter;
  universe: ScannerUniverse;
  mode: ScanMode;
  startedAt: string;
  completedAt: string;
  universeCount: number;
  candidateCount: number;
  /** Candidates already chart-enriched across all requested pages. */
  enrichedCount: number;
  /** Rows returned by this page only. */
  results: StockResult[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  skipped: string[];
}

export interface ScanPageOptions extends ScanOptions {
  page?: number;
  pageSize?: number;
}

const QUOTE_BATCH_SIZE = 100;
const CHART_BATCH_SIZE = 8;
/** Fast mode analyses everything below this candidate count. */
const FAST_FULL_SCAN_LIMIT = 120;
/** Fast-mode ceiling on chart-enriched candidates. Each one costs a Yahoo chart
 *  call, so this trades board size against wall-clock; deep mode is uncapped. */
const FAST_CANDIDATE_LIMIT = 120;
/** Upper bound on rows returned to a single scan. */
const MIN_SCREEN_SCORE = 35;
/** Enrichment is paid lazily, one page at a time, so these bound a page. */
export const DEFAULT_PAGE_SIZE = 15;
export const MAX_PAGE_SIZE = 60;
/** A page keeps enriching past `pageSize` until it has this many qualifying
 *  rows, because the score/conviction filter drops candidates. */
const PAGE_TARGET_MULTIPLIER = 2;
const PAGE_MIN_ENRICH = 8;
const PAGE_ENRICH_BUDGET = 45;
/** Paged sessions live as long as the result cache. */
const MAX_SESSIONS = 16;
const HISTORY_DAYS = 420;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 16;
const SESSION_TTL_MS = CACHE_TTL_MS;

const scanCache = new Map<string, { expiresAt: number; value: ScanResult }>();
const scanSessions = new Map<string, ScanSession>();

interface SessionParams {
  sector: string;
  direction: SignalFilter;
  setup: SetupFilter;
  presets: ScreenerPreset[];
  mode: ScanMode;
  minimumConviction: 'LOW' | 'MEDIUM' | 'HIGH';
  universe: ScannerUniverse;
}

/** Quotes are lens-independent, so the session is shared across presets. */
interface ScanSession {
  key: string;
  createdAt: number;
  sector: string;
  universe: ScannerUniverse;
  mode: ScanMode;
  signalFilter: SignalFilter;
  presets: ScreenerPreset[];
  minimumConviction: 'LOW' | 'MEDIUM' | 'HIGH';
  universeCount: number;
  /** Ranked, de-duplicated, ready to enrich. */
  candidates: QuoteCandidate[];
  cursor: number;
  enriched: StockResult[];
  skipped: string[];
}

function sessionKey(params: SessionParams): string {
  return [params.universe, params.sector, params.direction, params.mode, params.minimumConviction].join(':');
}

/** Accepts a comma list of presets so the board can fan out server-side. */
export function normalizePresets(setup: SetupFilter | string): ScreenerPreset[] {
  if (typeof setup === 'string' && setup.includes(',')) {
    const seen = new Set<ScreenerPreset>();
    for (const part of setup.split(',')) {
      const value = part.trim();
      if (value) seen.add(normalizeSetupFilter(value as SetupFilter));
    }
    return [...seen];
  }
  return [normalizeSetupFilter(setup as SetupFilter)];
}

export function clampPageSize(raw: unknown): number {
  const value = Math.floor(Number(raw));
  if (!Number.isFinite(value) || value < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(value, MAX_PAGE_SIZE);
}

export function normalizeSetupFilter(setup: SetupFilter): ScreenerPreset {
  return setup === 'all_time_low' ? 'near_52w_low' : setup;
}

function convictionRank(value: 'LOW' | 'MEDIUM' | 'HIGH'): number {
  return value === 'HIGH' ? 3 : value === 'MEDIUM' ? 2 : 1;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Scan cancelled');
}

function changePercent(current: number, previous?: number): number {
  return previous && previous > 0 ? ((current - previous) / previous) * 100 : 0;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export class IdxScannerService {
  async getUniverse(sector: string, universe: ScannerUniverse = 'idx'): Promise<StockEntry[]> {
    const normalized = normalizeScannerUniverse(universe);
    if (normalized === 'crypto') {
      const all = await globalUniverseService.getCryptoUniverse();
      const filtered = globalUniverseService.filterBySector(all, sector === 'all' ? 'all' : 'crypto');
      log.info('crypto-scanner', `universe: ${filtered.length} symbols (${sector}) from ${all.length} total`);
      return filtered;
    }
    if (normalized === 'us') {
      const all = await globalUniverseService.getUsUniverse();
      const filtered = globalUniverseService.filterBySector(all, sector);
      log.info('us-scanner', `universe: ${filtered.length} symbols (${sector}) from ${all.length} total`);
      return filtered;
    }
    const all = await idxUniverseService.getUniverse();
    const filtered = idxUniverseService.filterBySector(all, sector);
    log.info('idx-scanner', `universe: ${filtered.length} stocks (${sector}) from ${all.length} total`);
    return filtered;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private chunks<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  private preScoreQuote(quote: any, direction: SignalFilter, preset: ScreenerPreset): number {
    const price = finiteNumber(quote?.regularMarketPrice);
    const chg1d = finiteNumber(quote?.regularMarketChangePercent);
    const volume = finiteNumber(quote?.regularMarketVolume);
    const averageVolume = finiteNumber(quote?.averageDailyVolume10Day)
      || finiteNumber(quote?.averageDailyVolume3Month)
      || 1;
    const high52w = finiteNumber(quote?.fiftyTwoWeekHigh);
    const low52w = finiteNumber(quote?.fiftyTwoWeekLow);
    if (price <= 0 || volume <= 0) return -999;

    const volumeRatio = averageVolume > 0 ? volume / averageVolume : 1;
    const fromHigh = high52w > 0 ? ((price - high52w) / high52w) * 100 : -50;
    const fromLow = low52w > 0 ? ((price - low52w) / low52w) * 100 : 50;
    const distanceFromHigh = Math.abs(fromHigh);
    const liquidity = Math.min(20, Math.log10(Math.max(volume, 1)) * 2);
    let score = liquidity;

    if (preset === 'breakout') {
      score += fromHigh > -7 ? 35 : 0;
      score += chg1d > 0 ? Math.min(25, chg1d * 6) : -20;
      score += volumeRatio > 1.2 ? Math.min(25, volumeRatio * 8) : 0;
    } else if (preset === 'rebound') {
      score += fromLow >= 3 && fromLow <= 20 ? 35 : 0;
      score += chg1d > 0 ? Math.min(25, chg1d * 7) : -15;
      score += distanceFromHigh > 15 ? 10 : 0;
      score += volumeRatio > 1.1 ? Math.min(20, volumeRatio * 6) : 0;
    } else if (preset === 'near_52w_low') {
      score += fromLow < 5 ? 45 : Math.max(0, 20 - fromLow);
      score += chg1d <= 1 ? 10 : -10;
    } else if (preset === 'downtrend' || direction === 'sell') {
      score += chg1d < 0 ? Math.min(30, Math.abs(chg1d) * 8) : -20;
      score += distanceFromHigh > 20 ? 20 : 0;
      score += fromLow < 15 ? 15 : 0;
      score += volumeRatio > 1.2 ? Math.min(20, volumeRatio * 6) : 0;
    } else if (preset === 'oversold') {
      score += chg1d < -2 ? Math.min(35, Math.abs(chg1d) * 7) : 0;
      score += distanceFromHigh > 25 ? 20 : 0;
      score += fromLow < 20 ? 15 : 0;
      score += volumeRatio > 1.2 ? Math.min(20, volumeRatio * 6) : 0;
    } else {
      score += chg1d > 0 && chg1d <= 4 ? 30 : chg1d > 4 ? 12 : -15;
      score += volumeRatio > 1.2 ? Math.min(25, volumeRatio * 7) : 0;
      score += distanceFromHigh >= 10 && distanceFromHigh <= 45 && fromLow >= 15 ? 25 : 0;
      score += fromHigh > -5 ? -10 : 0;
    }

    return score;
  }

  /**
   * Fetch quotes for the whole universe.
   *
   * Deliberately lens-independent: the quote payload is the same for every
   * preset, so a multi-lens board pays this once instead of once per lens.
   */
  private async fetchQuoted(
    universe: StockEntry[],
    skipped: string[],
    signal?: AbortSignal,
  ): Promise<QuotedEntry[]> {
    const quoted: QuotedEntry[] = [];

    for (const batch of this.chunks(universe, QUOTE_BATCH_SIZE)) {
      throwIfAborted(signal);
      try {
        const quotes = await yahooFinance.quote(batch.map(stock => stock.ticker), {
          return: 'array',
          fields: [
            'symbol', 'shortName', 'longName', 'regularMarketPrice',
            'regularMarketChangePercent', 'regularMarketVolume',
            'averageDailyVolume10Day', 'averageDailyVolume3Month',
            'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'marketState',
            'quoteType', 'fullExchangeName', 'exchange', 'currency',
          ] as any,
        } as any);
        const bySymbol = new Map<string, any>();
        if (Array.isArray(quotes)) {
          for (const quote of quotes) {
            if (quote?.symbol) bySymbol.set(String(quote.symbol).toUpperCase(), quote);
          }
        }
        for (const stock of batch) {
          const quote = bySymbol.get(stock.ticker.toUpperCase());
          if (!quote || quote.regularMarketPrice == null) {
            skipped.push(stock.ticker);
            continue;
          }
          quoted.push({ ...stock, quote });
        }
      } catch {
        for (const retryBatch of this.chunks(batch, 10)) {
          throwIfAborted(signal);
          await Promise.all(retryBatch.map(async stock => {
            const quote = await yahooFinance.quote(stock.ticker).catch(() => null);
            if (!quote || (quote as any).regularMarketPrice == null) {
              skipped.push(stock.ticker);
              return;
            }
            quoted.push({ ...stock, quote });
          }));
          await this.sleep(100);
        }
      }
      if (batch.length === QUOTE_BATCH_SIZE) await this.sleep(150);
    }

    return quoted;
  }

  /**
   * Rank quoted entries for one lens. Cheap and purely in-memory.
   *
   * Always sorts, even when nothing is truncated: a paged board enriches in
   * queue order, so the ranking decides what lands on page 1.
   */
  private rankCandidates(
    quoted: QuotedEntry[],
    direction: SignalFilter,
    preset: ScreenerPreset,
    mode: ScanMode,
  ): QuoteCandidate[] {
    const scored = quoted
      .map(entry => ({ ...entry, preScore: this.preScoreQuote(entry.quote, direction, preset), preset }))
      .sort((left, right) => right.preScore - left.preScore);
    if (mode === 'deep' || scored.length <= FAST_FULL_SCAN_LIMIT) return scored;
    return scored.filter(candidate => candidate.preScore > -100).slice(0, FAST_CANDIDATE_LIMIT);
  }

  private async fetchQuoteCandidates(
    universe: StockEntry[],
    direction: SignalFilter,
    preset: ScreenerPreset,
    mode: ScanMode,
    skipped: string[],
    signal?: AbortSignal,
  ): Promise<QuoteCandidate[]> {
    return this.rankCandidates(
      await this.fetchQuoted(universe, skipped, signal),
      direction,
      preset,
      mode,
    );
  }

  private chartCandles(chartResult: any): Candle[] {
    const quotes = Array.isArray(chartResult?.quotes) ? chartResult.quotes : [];
    return quotes.flatMap((quote: any): Candle[] => {
      const open = finiteNumber(quote?.open, Number.NaN);
      const high = finiteNumber(quote?.high, Number.NaN);
      const low = finiteNumber(quote?.low, Number.NaN);
      const close = finiteNumber(quote?.close, Number.NaN);
      if (![open, high, low, close].every(Number.isFinite)) return [];
      return [{
        date: quote?.date instanceof Date ? quote.date : new Date(quote?.date ?? Date.now()),
        open,
        high,
        low,
        close,
        volume: Math.max(0, finiteNumber(quote?.volume)),
      }];
    });
  }

  private async enrichCandidate(
    candidate: QuoteCandidate,
    preset: ScreenerPreset,
    abortSignal?: AbortSignal,
  ): Promise<StockResult | null> {
    throwIfAborted(abortSignal);
    const period1 = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
    const chartResult = await yahooFinance.chart(candidate.ticker, {
      period1,
      interval: '1d',
    }).catch(() => null);
    const rawCandles = this.chartCandles(chartResult);
    if (rawCandles.length < 20) return null;

    const indicators = new IndicatorsService();
    const chartAnalyzer = new ChartAnalyzer();
    const candles = indicators.calculateAll(rawCandles);
    const quote = candidate.quote;
    const price = finiteNumber(quote?.regularMarketPrice, candles.at(-1)?.close ?? 0);
    const volume = finiteNumber(quote?.regularMarketVolume, candles.at(-1)?.volume ?? 0);
    const previousVolumes = candles.slice(-21, -1).map(candle => candle.volume).filter(value => value > 0);
    const averageVolume = previousVolumes.length > 0
      ? previousVolumes.reduce((sum, value) => sum + value, 0) / previousVolumes.length
      : finiteNumber(quote?.averageDailyVolume10Day) || finiteNumber(quote?.averageDailyVolume3Month) || 1;
    const volumeRatio = averageVolume > 0 ? volume / averageVolume : 1;
    const last = candles.at(-1);
    if (!last || price <= 0) return null;
    last.Volume_Ratio = volumeRatio;

    const high52w = finiteNumber(quote?.fiftyTwoWeekHigh);
    const low52w = finiteNumber(quote?.fiftyTwoWeekLow);
    const from52wHigh = high52w > 0 ? ((price - high52w) / high52w) * 100 : null;
    const from52wLow = low52w > 0 ? ((price - low52w) / low52w) * 100 : null;
    const chg1d = finiteNumber(quote?.regularMarketChangePercent, changePercent(price, candles.at(-2)?.close));
    const chg5d = changePercent(price, candles.at(-6)?.close);
    const chg20d = changePercent(price, candles.at(-21)?.close);
    const patterns = chartAnalyzer.analyzeChartPatterns(candles);
    const quoteSnapshot: QuoteSnapshot = {
      name: quote?.longName ?? quote?.shortName ?? candidate.name,
      fiftyTwoWeekHigh: high52w || null,
      fiftyTwoWeekLow: low52w || null,
      marketState: quote?.marketState ?? null,
      quoteType: quote?.quoteType ?? null,
      exchange: quote?.fullExchangeName ?? quote?.exchange ?? null,
      currency: quote?.currency ?? null,
      averageVolume,
    };
    const analysis = buildDashboardAnalysis({
      ticker: candidate.ticker,
      candles,
      quote: quoteSnapshot,
      patterns,
    });
    const asOf = last.date instanceof Date && !Number.isNaN(last.date.getTime())
      ? last.date.toISOString()
      : new Date().toISOString();
    const expertSignal = buildExpertSignal(analysis, asOf);
    const metrics = {
      price,
      chg1d,
      chg5d,
      chg20d,
      volumeRatio,
      rsi: analysis.structure.rsi,
      macdHistogram: analysis.structure.macdHist,
      from52wHigh,
      from52wLow,
      atrPercent: analysis.structure.atrPercent,
    };
    const screenScore = scoreScreenerPreset(preset, metrics);
    const legacySignal: ScanSignal = expertSignal.action === 'BUY'
      ? 'BUY'
      : expertSignal.action === 'SELL'
        ? 'AVOID'
        : 'WATCH';
    const macdSignal = metrics.macdHistogram == null
      ? 'NEUTRAL'
      : metrics.macdHistogram > 0
        ? 'BULLISH'
        : metrics.macdHistogram < 0
          ? 'BEARISH'
          : 'NEUTRAL';

    return {
      ticker: candidate.ticker,
      name: candidate.name,
      sector: candidate.sector,
      metrics,
      screenScore,
      matchedPreset: preset,
      expertSignal,
      price,
      chg1d,
      chg5d,
      chg20d,
      volRatio: volumeRatio,
      from52wHigh: from52wHigh ?? 0,
      from52wLow: from52wLow ?? 0,
      rsi: metrics.rsi,
      macdSignal,
      score: screenScore,
      signal: legacySignal,
      reason: expertSignal.reasons[0] ?? expertSignal.plan.setup,
      setupType: screenScore >= MIN_SCREEN_SCORE ? preset : 'none',
    };
  }

  private cacheKey(
    sector: string,
    direction: SignalFilter,
    preset: ScreenerPreset,
    mode: ScanMode,
    minimumConviction: 'LOW' | 'MEDIUM' | 'HIGH',
    universe: ScannerUniverse,
  ): string {
    return [universe, sector, direction, preset, mode, minimumConviction].join(':');
  }

  private getCached(key: string): ScanResult | null {
    const cached = scanCache.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      scanCache.delete(key);
      return null;
    }
    return { ...cached.value, cacheHit: true };
  }

  private setCached(key: string, value: ScanResult): void {
    if (scanCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = scanCache.keys().next().value;
      if (oldestKey) scanCache.delete(oldestKey);
    }
    scanCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  }

  // ── Paged (lazy) scans ─────────────────────────────────────────────────────
  //
  // A full scan chart-enriches every candidate before returning anything, so
  // the board used to sit blank for the whole run. Instead a session holds the
  // quote-only candidate list and enriches forward one page at a time: page 1
  // costs one quote sweep plus ~a batch of charts, and later pages cost only
  // the charts they still need.

  private async ensureSession(
    params: SessionParams,
    signal?: AbortSignal,
  ): Promise<ScanSession> {
    const key = sessionKey(params);
    const existing = scanSessions.get(key);
    if (existing && existing.createdAt + SESSION_TTL_MS > Date.now()) {
      scanSessions.delete(key);
      scanSessions.set(key, existing);
      return existing;
    }

    const universe = await this.getUniverse(params.sector, params.universe);
    const skipped: string[] = [];
    const quoted = await this.fetchQuoted(universe, skipped, signal);
    const presets = params.presets.length > 0 ? params.presets : [normalizeSetupFilter(params.setup)];
    const candidates = this.buildQueue(quoted, params, presets);

    if (scanSessions.size >= MAX_SESSIONS) {
      const oldestKey = scanSessions.keys().next().value;
      if (oldestKey) scanSessions.delete(oldestKey);
    }
    const session: ScanSession = {
      key,
      createdAt: Date.now(),
      sector: params.sector,
      universe: params.universe,
      mode: params.mode,
      signalFilter: params.direction,
      presets,
      minimumConviction: params.minimumConviction,
      universeCount: universe.length,
      candidates,
      cursor: 0,
      enriched: [],
      skipped,
    };
    scanSessions.set(key, session);
    log.info('scan-session', `queued ${candidates.length} candidates from ${universe.length} universe symbols`);
    return session;
  }

  /**
   * Interleave the per-lens rankings into one queue.
   *
   * Round-robin means page 1 samples every lens instead of draining the first
   * one, and de-duplicating keeps the best-ranked lens for a ticker that
   * qualifies under several.
   */
  private buildQueue(
    quoted: QuotedEntry[],
    params: SessionParams,
    presets: ScreenerPreset[],
  ): QuoteCandidate[] {
    const lists = presets.map(preset => this.rankCandidates(quoted, params.direction, preset, params.mode));
    const queue: QuoteCandidate[] = [];
    const seen = new Set<string>();
    const longest = Math.max(0, ...lists.map(list => list.length));

    for (let index = 0; index < longest; index++) {
      for (const list of lists) {
        const candidate = list[index];
        if (!candidate || seen.has(candidate.ticker)) continue;
        seen.add(candidate.ticker);
        queue.push(candidate);
      }
    }
    return queue;
  }

  private pageQualifies(
    result: StockResult,
    signalFilter: SignalFilter,
    minimumConviction: 'LOW' | 'MEDIUM' | 'HIGH',
  ): boolean {
    if (result.screenScore < MIN_SCREEN_SCORE) return false;
    if (convictionRank(result.expertSignal.conviction) < convictionRank(minimumConviction)) return false;
    if (signalFilter === 'buy') {
      return result.expertSignal.action === 'BUY'
        || (result.expertSignal.action === 'WATCH' && result.expertSignal.bias === 'BULL');
    }
    if (signalFilter === 'sell') {
      return result.expertSignal.action === 'SELL'
        || (result.expertSignal.action === 'WATCH' && result.expertSignal.bias === 'BEAR');
    }
    return true;
  }

  /** Enrich forward until `target` qualifying rows exist or the queue runs dry. */
  private async enrichPage(
    session: ScanSession,
    target: number,
    signal?: AbortSignal,
  ): Promise<StockResult[]> {
    const collected: StockResult[] = [];
    const budget = Math.min(session.candidates.length, session.cursor + PAGE_ENRICH_BUDGET);
    const floor = Math.min(budget, session.cursor + Math.max(PAGE_MIN_ENRICH, target * PAGE_TARGET_MULTIPLIER));

    while (collected.length < target && session.cursor < budget) {
      throwIfAborted(signal);
      const slice = session.candidates.slice(session.cursor, Math.min(floor, session.cursor + CHART_BATCH_SIZE));
      if (slice.length === 0) break;
      session.cursor += slice.length;

      const enriched = await Promise.all(slice.map(async candidate => {
        try {
          return await this.enrichCandidate(candidate, candidate.preset, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          return null;
        }
      }));

      enriched.forEach((result, index) => {
        if (!result) {
          session.skipped.push(slice[index].ticker);
          return;
        }
        session.enriched.push(result);
        if (this.pageQualifies(result, session.signalFilter, session.minimumConviction)) {
          collected.push(result);
        }
      });

      if (session.cursor < floor) await this.sleep(150);
    }

    return collected.sort((left, right) => right.screenScore - left.screenScore);
  }

  /**
   * Return one page. Work already done is reused from the session, so paging
   * forward never re-runs the quote sweep or a chart call.
   */
  async scanPage(
    sector: string = 'all',
    signalFilter: SignalFilter = 'buy',
    setup: SetupFilter = 'momentum',
    mode: ScanMode = 'fast',
    options: ScanPageOptions = {},
  ): Promise<ScanPage> {
    const presets = normalizePresets(setup);
    const page = Math.max(0, Math.floor(options.page ?? 0) || 0);
    const pageSize = clampPageSize(options.pageSize);
    const scannerUniverse = normalizeScannerUniverse(options.universe ?? 'idx');

    const release = mode === 'deep' ? deepScanWorkloadGate.tryAcquire() : () => undefined;
    if (!release) {
      const busyLabel = scannerUniverse === 'crypto' ? 'A deep Crypto scan is already running'
        : scannerUniverse === 'us' ? 'A deep US scan is already running'
        : 'A deep IDX scan is already running';
      throw new WorkloadBusyError(busyLabel);
    }

    const startedAt = new Date().toISOString();
    try {
      const params: SessionParams = {
        sector,
        direction: signalFilter,
        setup,
        presets,
        mode,
        minimumConviction: options.minimumConviction ?? 'LOW',
        universe: scannerUniverse,
      };
      const session = await this.ensureSession(params, options.signal);
      throwIfAborted(options.signal);

      const collected: StockResult[] = [];
      let exhausted = session.cursor >= session.candidates.length;

      for (let index = 0; index <= page && !exhausted; index++) {
        // Re-serving an earlier page must not double-count rows.
        const rows = await this.enrichPage(session, pageSize, options.signal);
        collected.length = 0;
        collected.push(...rows);
        exhausted = session.cursor >= session.candidates.length;
      }

      const results = collected.slice(0, pageSize) as StockResult[];

      return {
        sector: session.sector,
        presets: session.presets,
        signalFilter: session.signalFilter,
        universe: session.universe,
        mode: session.mode,
        startedAt,
        completedAt: new Date().toISOString(),
        universeCount: session.universeCount,
        candidateCount: session.candidates.length,
        enrichedCount: session.enriched.length,
        results,
        page,
        pageSize,
        hasMore: session.cursor < session.candidates.length,
        skipped: session.skipped,
      };
    } finally {
      release();
    }
  }

  /** Drop cached paged sessions (used by tests and manual refresh). */
  resetSessions(): void {
    scanSessions.clear();
  }

  async scan(
    sector: string = 'all',
    signalFilter: SignalFilter = 'buy',
    setup: SetupFilter = 'momentum',
    mode: ScanMode = 'fast',
    options: ScanOptions = {},
  ): Promise<ScanResult> {
    const preset = normalizeSetupFilter(setup);
    const minimumConviction = options.minimumConviction ?? 'LOW';
    const scannerUniverse = normalizeScannerUniverse(options.universe ?? 'idx');
    const cacheKey = this.cacheKey(sector, signalFilter, preset, mode, minimumConviction, scannerUniverse);
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const release = mode === 'deep' ? deepScanWorkloadGate.tryAcquire() : () => undefined;
    if (!release) {
      const busyLabel = scannerUniverse === 'crypto' ? 'A deep Crypto scan is already running'
        : scannerUniverse === 'us' ? 'A deep US scan is already running'
        : 'A deep IDX scan is already running';
      throw new WorkloadBusyError(busyLabel);
    }
    const startedAt = new Date().toISOString();

    try {
      throwIfAborted(options.signal);
      const universe = await this.getUniverse(sector, scannerUniverse);
      const skipped: string[] = [];
      const quoted = await this.fetchQuoteCandidates(universe, signalFilter, preset, mode, skipped, options.signal);
      const chartCandidates = quoted;
      const enriched: StockResult[] = [];

      log.info(
        scannerUniverse === 'crypto' ? 'crypto-scanner' : scannerUniverse === 'us' ? 'us-scanner' : 'idx-scanner',
        `${mode} quote prefilter: ${chartCandidates.length}/${quoted.length} chart candidates from ${universe.length} universe`,
      );

      for (const batch of this.chunks(chartCandidates, CHART_BATCH_SIZE)) {
        throwIfAborted(options.signal);
        const results = await Promise.all(batch.map(async candidate => {
          try {
            return await this.enrichCandidate(candidate, preset, options.signal);
          } catch (error) {
            if (options.signal?.aborted) throw error;
            return null;
          }
        }));
        results.forEach((result, index) => {
          if (result) enriched.push(result);
          else skipped.push(batch[index].ticker);
        });
        if (batch.at(-1) !== chartCandidates.at(-1)) await this.sleep(250);
      }

      const matched = enriched
        .filter(result => result.screenScore >= MIN_SCREEN_SCORE)
        .filter(result => convictionRank(result.expertSignal.conviction) >= convictionRank(minimumConviction))
        .filter(result => {
          if (signalFilter === 'buy') {
            return result.expertSignal.action === 'BUY'
              || (result.expertSignal.action === 'WATCH' && result.expertSignal.bias === 'BULL');
          }
          if (signalFilter === 'sell') {
            return result.expertSignal.action === 'SELL'
              || (result.expertSignal.action === 'WATCH' && result.expertSignal.bias === 'BEAR');
          }
          return true;
        })
        .sort((left, right) =>
          right.screenScore - left.screenScore
          || Math.abs(right.expertSignal.score) - Math.abs(left.expertSignal.score),
        )
        .slice(0, MAX_SCAN_RESULTS);

      const buyCount = enriched.filter(result => result.expertSignal.action === 'BUY').length;
      const sellCount = enriched.filter(result => result.expertSignal.action === 'SELL').length;
      const watchCount = enriched.filter(result => result.expertSignal.action === 'WATCH').length;
      const bullishCount = enriched.filter(result => result.expertSignal.bias === 'BULL').length;
      const bearishCount = enriched.filter(result => result.expertSignal.bias === 'BEAR').length;
      const neutralCount = enriched.filter(result => result.expertSignal.bias === 'NEUTRAL').length;
      const avgScore = enriched.length > 0
        ? enriched.reduce((sum, result) => sum + result.expertSignal.score, 0) / enriched.length
        : 0;
      const breadthSignal = this.breadthSignal(enriched.length, bullishCount, bearishCount);
      const buys = matched.filter(result => result.expertSignal.action === 'BUY').slice(0, 8);
      const watches = matched.filter(result => result.expertSignal.action === 'WATCH').slice(0, 8);
      const avoids = matched.filter(result => result.expertSignal.action === 'SELL').slice(0, 8);
      const completedAt = new Date().toISOString();
      const result: ScanResult = {
        sector,
        preset,
        signalFilter,
        universe: scannerUniverse,
        mode,
        startedAt,
        completedAt,
        universeCount: universe.length,
        candidateCount: chartCandidates.length,
        totalScanned: enriched.length,
        buyCount,
        sellCount,
        watchCount,
        avoidCount: sellCount,
        bullishCount,
        bearishCount,
        neutralCount,
        avgScore,
        breadthSignal,
        partial: chartCandidates.length < quoted.length || skipped.length > 0,
        cacheHit: false,
        results: matched,
        buys,
        watches,
        avoids,
        skipped: [...new Set(skipped)],
        formatted: this.format(
          sector,
          preset,
          mode,
          universe.length,
          enriched.length,
          matched,
          breadthSignal,
          scannerUniverse,
        ),
      };
      this.setCached(cacheKey, result);
      return result;
    } finally {
      release();
    }
  }

  private breadthSignal(total: number, bullish: number, bearish: number): string {
    if (total === 0) return 'UNAVAILABLE — no enriched candidates';
    if (bullish >= total * 0.5) return 'BROAD RALLY — bullish evidence dominates';
    if (bullish >= total * 0.3) return 'SELECTIVE MOMENTUM — rotate carefully';
    if (bearish >= total * 0.5) return 'WEAK MARKET — bearish evidence dominates';
    return 'MIXED — stock-picking environment';
  }

  private format(
    sector: string,
    preset: ScreenerPreset,
    mode: ScanMode,
    universeCount: number,
    enrichedCount: number,
    results: StockResult[],
    breadthSignal: string,
    scannerUniverse: ScannerUniverse = 'idx',
  ): string {
    const lines = results.slice(0, 12).map((result, index) => {
      const signal = result.expertSignal;
      const warning = signal.warnings[0] ? ` | Warning: ${signal.warnings[0]}` : '';
      return `${index + 1}. ${result.ticker} — screen ${result.screenScore}/100 | ${signal.action} ${signal.conviction} (${signal.score >= 0 ? '+' : ''}${signal.score}) | ${signal.reasons[0] ?? signal.plan.setup}${warning}`;
    });
    const normalized = normalizeScannerUniverse(scannerUniverse);
    const label = normalized === 'crypto' ? 'CRYPTO SCREENER' : normalized === 'us' ? 'US SCREENER' : 'IDX SCREENER';
    return [
      `${label} — ${preset.replaceAll('_', ' ').toUpperCase()} (${sector}, ${mode})`,
      `Coverage: ${enrichedCount} enriched from ${universeCount} symbols. Breadth: ${breadthSignal}.`,
      lines.length > 0 ? lines.join('\n') : 'No candidates met the selected screen and direction filters.',
      'Expert Signal is deterministic technical confluence, not a forecast. Confirm entries with current price and volume.',
    ].join('\n');
  }
}

export const idxScannerService = new IdxScannerService();
