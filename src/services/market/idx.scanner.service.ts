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
import type { Candle } from '../../types/types.js';
import { log } from '../../utils/logger.js';
import { deepScanWorkloadGate, WorkloadBusyError } from '../security/workload-gate.js';
import { IndicatorsService } from './indicators.service.js';
import { idxUniverseService } from './idx.universe.service.js';
import { yahooFinance } from './yahoo.service.js';

export type ScanSignal = 'BUY' | 'WATCH' | 'AVOID';
export type SignalFilter = ScreenerDirection;
export type SetupFilter = ScreenerPreset | 'all_time_low';
export type ScanMode = ScreenerMode;
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

interface QuoteCandidate extends StockEntry {
  quote: any;
  preScore: number;
}

export interface ScanOptions {
  minimumConviction?: 'LOW' | 'MEDIUM' | 'HIGH';
  signal?: AbortSignal;
}

const QUOTE_BATCH_SIZE = 100;
const CHART_BATCH_SIZE = 8;
const FAST_FULL_SCAN_LIMIT = 60;
const FAST_CANDIDATE_LIMIT = 60;
const MIN_SCREEN_SCORE = 35;
const HISTORY_DAYS = 420;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 16;

const scanCache = new Map<string, { expiresAt: number; value: ScanResult }>();

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
  async getUniverse(sector: string): Promise<StockEntry[]> {
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

  private async fetchQuoteCandidates(
    universe: StockEntry[],
    direction: SignalFilter,
    preset: ScreenerPreset,
    skipped: string[],
    signal?: AbortSignal,
  ): Promise<QuoteCandidate[]> {
    const candidates: QuoteCandidate[] = [];

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
          candidates.push({
            ...stock,
            quote,
            preScore: this.preScoreQuote(quote, direction, preset),
          });
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
            candidates.push({
              ...stock,
              quote,
              preScore: this.preScoreQuote(quote, direction, preset),
            });
          }));
          await this.sleep(100);
        }
      }
      if (batch.length === QUOTE_BATCH_SIZE) await this.sleep(150);
    }

    return candidates;
  }

  private selectChartCandidates(candidates: QuoteCandidate[], mode: ScanMode): QuoteCandidate[] {
    if (mode === 'deep' || candidates.length <= FAST_FULL_SCAN_LIMIT) return candidates;
    return [...candidates]
      .filter(candidate => candidate.preScore > -100)
      .sort((left, right) => right.preScore - left.preScore)
      .slice(0, FAST_CANDIDATE_LIMIT);
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
    sector: IdxSector,
    direction: SignalFilter,
    preset: ScreenerPreset,
    mode: ScanMode,
    minimumConviction: 'LOW' | 'MEDIUM' | 'HIGH',
  ): string {
    return [sector, direction, preset, mode, minimumConviction].join(':');
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

  async scan(
    sector: IdxSector = 'all',
    signalFilter: SignalFilter = 'buy',
    setup: SetupFilter = 'momentum',
    mode: ScanMode = 'fast',
    options: ScanOptions = {},
  ): Promise<ScanResult> {
    const preset = normalizeSetupFilter(setup);
    const minimumConviction = options.minimumConviction ?? 'LOW';
    const cacheKey = this.cacheKey(sector, signalFilter, preset, mode, minimumConviction);
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const release = mode === 'deep' ? deepScanWorkloadGate.tryAcquire() : () => undefined;
    if (!release) throw new WorkloadBusyError('A deep IDX scan is already running');
    const startedAt = new Date().toISOString();

    try {
      throwIfAborted(options.signal);
      const universe = await this.getUniverse(sector);
      const skipped: string[] = [];
      const quoted = await this.fetchQuoteCandidates(universe, signalFilter, preset, skipped, options.signal);
      const chartCandidates = this.selectChartCandidates(quoted, mode);
      const enriched: StockResult[] = [];

      log.info(
        'idx-scanner',
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
        .slice(0, 100);

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
  ): string {
    const lines = results.slice(0, 12).map((result, index) => {
      const signal = result.expertSignal;
      const warning = signal.warnings[0] ? ` | Warning: ${signal.warnings[0]}` : '';
      return `${index + 1}. ${result.ticker} — screen ${result.screenScore}/100 | ${signal.action} ${signal.conviction} (${signal.score >= 0 ? '+' : ''}${signal.score}) | ${signal.reasons[0] ?? signal.plan.setup}${warning}`;
    });
    return [
      `IDX SCREENER — ${preset.replaceAll('_', ' ').toUpperCase()} (${sector}, ${mode})`,
      `Coverage: ${enrichedCount} enriched from ${universeCount} symbols. Breadth: ${breadthSignal}.`,
      lines.length > 0 ? lines.join('\n') : 'No candidates met the selected screen and direction filters.',
      'Expert Signal is deterministic technical confluence, not a forecast. Confirm entries with current price and volume.',
    ].join('\n');
  }
}

export const idxScannerService = new IdxScannerService();
