// ─── services/idx.scanner.service.ts ─────────────────────────────────────────
// IDX (Indonesia Stock Exchange) momentum scanner.
// Quote-screens the full IDX universe, then scores selected candidates on price-momentum,
// volume-surge, and 52-week range signals, then surfaces ranked setups.
//
// Intentionally lives here, not in agents/, so it can be reused by any
// analyzer, agent, or future CLI command without duplication.

import { yahooFinance } from './yahoo.service.js';
import { idxUniverseService } from './idx.universe.service.js';
import { log } from '../../utils/logger.js';
import { deepScanWorkloadGate, WorkloadBusyError } from '../security/workload-gate.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScanSignal = 'BUY' | 'WATCH' | 'AVOID';
export type SignalFilter = 'buy' | 'sell' | 'any';
export type SetupFilter = 'momentum' | 'rebound' | 'all_time_low' | 'downtrend' | 'breakout' | 'oversold';
export type ScanMode = 'fast' | 'deep';
export type IdxSector =
  | 'all' | 'banking' | 'consumer' | 'mining' | 'energy'
  | 'tech' | 'property' | 'telecom' | 'healthcare' | 'industrial';

export interface StockEntry {
  ticker: string;
  name:   string;
  sector: string;
}

export interface StockResult extends StockEntry {
  price:       number;
  chg1d:       number;  // % change today
  chg5d:       number;  // % change over 5 trading days
  chg20d:      number;  // % change over 20 trading days
  volRatio:    number;  // today volume / 20-day avg volume
  from52wHigh: number;  // % distance below 52-week high (negative value)
  from52wLow:  number;  // % distance above 52-week low  (positive value)
  score:       number;  // composite momentum score  -100 → +100
  signal:      ScanSignal;
  reason:      string;
  setupType:   SetupFilter | 'none';
}

export interface ScanResult {
  sector:        string;
  mode:          ScanMode;
  universeCount: number;
  candidateCount:number;
  totalScanned:  number;
  buyCount:      number;
  watchCount:    number;
  avoidCount:    number;
  avgScore:      number;
  breadthSignal: string;
  buys:          StockResult[];
  watches:       StockResult[];
  avoids:        StockResult[];
  skipped:       string[];   // tickers that failed to fetch
  formatted:     string;     // pre-rendered text for the agent observation
}

interface QuoteCandidate extends StockEntry {
  quote:    any;
  preScore: number;
}

const QUOTE_BATCH_SIZE     = 100;
const CHART_BATCH_SIZE     = 8;
const FAST_FULL_SCAN_LIMIT = 120;
const FAST_CANDIDATE_LIMIT = 180;
const FAST_MIN_CANDIDATES  = 60;



// ─── Scoring logic ────────────────────────────────────────────────────────────
// Composite score: -100 → +100.  Higher = stronger bullish momentum.
//
// The key design goal: reward stocks that are quietly recovering (10-40% below
// their 52w high, well above their 52w low, building volume) rather than ones
// that have already made a big move everyone already knows about.

function scoreStock(
  chg1d:       number,
  chg5d:       number,
  chg20d:      number,
  volRatio:    number,
  from52wHigh: number,  // negative number: -20 means 20% below 52w high
  from52wLow:  number,  // positive number: +30 means 30% above 52w low
): number {
  let score = 0;

  // ── 1-day momentum (weight 20) ──────────────────────────────────────────
  // Moderate gain beats a huge spike — spike = late-entry risk
  if      (chg1d > 0  && chg1d <= 3)  score += 20;
  else if (chg1d > 3  && chg1d <= 6)  score += 12;
  else if (chg1d > 6)                 score += 5;
  else if (chg1d < 0  && chg1d >= -2) score -= 5;
  else if (chg1d < -2)                score -= 15;

  // ── 5-day trend (weight 25) ─────────────────────────────────────────────
  // Shows whether momentum is building over a week, not just today
  if      (chg5d > 2  && chg5d <= 8)  score += 25;
  else if (chg5d > 8)                 score += 10;
  else if (chg5d > 0)                 score += 12;
  else if (chg5d < -5)                score -= 20;
  else if (chg5d < 0)                 score -= 8;

  // ── 20-day trend (weight 20) ────────────────────────────────────────────
  if      (chg20d > 5)   score += 20;
  else if (chg20d > 0)   score += 8;
  else if (chg20d < -10) score -= 20;
  else if (chg20d < 0)   score -= 8;

  // ── Volume surge (weight 20) ────────────────────────────────────────────
  // Volume spike on an up day = institutional buying signal
  // Volume spike on a down day = distribution / exit signal
  if      (volRatio > 2.0 && chg1d > 0) score += 20;
  else if (volRatio > 1.5 && chg1d > 0) score += 12;
  else if (volRatio > 1.2 && chg1d > 0) score += 6;
  else if (volRatio > 2.0 && chg1d < 0) score -= 15;
  else if (volRatio < 0.5)               score -= 5;

  // ── 52-week range position (weight 15) ─────────────────────────────────
  // Sweet spot: 10-40% below 52w high AND 20%+ above 52w low.
  // That's the hidden-mover zone — recovering but not yet crowded.
  const distFromHigh = Math.abs(from52wHigh);
  const distFromLow  = from52wLow;

  if      (distFromHigh >= 10 && distFromHigh <= 40 && distFromLow >= 20) score += 15;
  else if (distFromHigh < 5)   score -= 10;  // near ATH = late entry
  else if (distFromHigh > 60)  score -= 10;  // too far = probably broken
  else if (distFromLow < 5)    score -= 10;  // near 52w low = avoid

  return score;
}

function classifySignal(
  score:       number,
  chg5d:       number,
  chg1d:       number,
  volRatio:    number,
  from52wHigh: number,
  from52wLow:  number,
): { signal: ScanSignal; reason: string } {
  const distFromHigh = Math.abs(from52wHigh);

  if (score >= 35) {
    const parts: string[] = [];
    if (chg5d > 2)                                    parts.push(`${chg5d.toFixed(1)}% in 5d`);
    if (volRatio > 1.5)                               parts.push(`vol ${volRatio.toFixed(1)}x avg`);
    if (distFromHigh >= 10 && distFromHigh <= 40)     parts.push(`${distFromHigh.toFixed(0)}% below 52wH (room to run)`);
    return { signal: 'BUY', reason: parts.join(' · ') || 'momentum building' };
  }

  if (score >= 10) {
    const parts: string[] = [];
    if (chg5d > 0)  parts.push(`mild 5d gain ${chg5d.toFixed(1)}%`);
    if (chg1d > 0)  parts.push(`today +${chg1d.toFixed(1)}%`);
    return { signal: 'WATCH', reason: parts.join(' · ') || 'mixed signals, monitor' };
  }

  const parts: string[] = [];
  if (chg5d < 0)        parts.push(`5d loss ${chg5d.toFixed(1)}%`);
  if (distFromHigh < 5) parts.push('near 52wH (late entry)');
  if (from52wLow < 5)   parts.push('near 52w low (weakness)');
  return { signal: 'AVOID', reason: parts.join(' · ') || 'no momentum' };
}

// ─── IdxScannerService ────────────────────────────────────────────────────────

export class IdxScannerService {

  /** Return the cached IDX stock universe for a given sector. */
  async getUniverse(sector: string): Promise<StockEntry[]> {
    const all = await idxUniverseService.getUniverse();
    const filtered = idxUniverseService.filterBySector(all, sector);
    log.info('idx-scanner', `universe: ${filtered.length} stocks (${sector}) from ${all.length} total`);
    return filtered;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private chunks<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  private quoteNumber(quote: any, key: string, fallback = 0): number {
    const value = quote?.[key];
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  private preScoreQuote(quote: any, signalFilter: SignalFilter, setup: SetupFilter): number {
    const price   = this.quoteNumber(quote, 'regularMarketPrice');
    const chg1d   = this.quoteNumber(quote, 'regularMarketChangePercent');
    const vol     = this.quoteNumber(quote, 'regularMarketVolume');
    const avgVol  = this.quoteNumber(quote, 'averageDailyVolume10Day') ||
      this.quoteNumber(quote, 'averageDailyVolume3Month') ||
      1;
    const high52w = this.quoteNumber(quote, 'fiftyTwoWeekHigh');
    const low52w  = this.quoteNumber(quote, 'fiftyTwoWeekLow');

    if (price <= 0 || vol <= 0) return -999;

    const volRatio      = avgVol > 0 ? vol / avgVol : 1;
    const from52wHigh   = high52w > 0 ? ((price - high52w) / high52w) * 100 : 0;
    const from52wLow    = low52w > 0 ? ((price - low52w) / low52w) * 100 : 0;
    const distFromHigh  = Math.abs(from52wHigh);
    const liquidityBump = Math.min(20, Math.log10(Math.max(vol, 1)) * 2);

    let score = liquidityBump;

    if (setup === 'breakout') {
      score += from52wHigh > -7 ? 35 : 0;
      score += chg1d > 0 ? Math.min(25, chg1d * 6) : -20;
      score += volRatio > 1.2 ? Math.min(25, volRatio * 8) : 0;
      return score;
    }

    if (setup === 'rebound') {
      score += from52wLow >= 3 && from52wLow <= 18 ? 35 : 0;
      score += chg1d > 0 ? Math.min(25, chg1d * 7) : -15;
      score += distFromHigh > 15 ? 10 : 0;
      score += volRatio > 1.1 ? Math.min(20, volRatio * 6) : 0;
      return score;
    }

    if (setup === 'all_time_low') {
      score += from52wLow < 5 ? 45 : Math.max(0, 20 - from52wLow);
      score += chg1d <= 1 ? 10 : -10;
      return score;
    }

    if (setup === 'downtrend' || signalFilter === 'sell') {
      score += chg1d < 0 ? Math.min(30, Math.abs(chg1d) * 8) : -20;
      score += distFromHigh > 20 ? 20 : 0;
      score += from52wLow < 15 ? 15 : 0;
      score += volRatio > 1.2 ? Math.min(20, volRatio * 6) : 0;
      return score;
    }

    if (setup === 'oversold') {
      score += chg1d < -2 ? Math.min(35, Math.abs(chg1d) * 7) : 0;
      score += distFromHigh > 25 ? 20 : 0;
      score += from52wLow < 20 ? 15 : 0;
      score += volRatio > 1.2 ? Math.min(20, volRatio * 6) : 0;
      return score;
    }

    score += chg1d > 0 && chg1d <= 4 ? 30 : chg1d > 4 ? 12 : -15;
    score += volRatio > 1.2 ? Math.min(25, volRatio * 7) : 0;
    score += distFromHigh >= 10 && distFromHigh <= 45 && from52wLow >= 15 ? 25 : 0;
    score += from52wHigh > -5 ? -10 : 0;
    return score;
  }

  private async fetchQuoteCandidates(universe: StockEntry[], signalFilter: SignalFilter, setup: SetupFilter, skipped: string[]): Promise<QuoteCandidate[]> {
    const candidates: QuoteCandidate[] = [];

    for (const batch of this.chunks(universe, QUOTE_BATCH_SIZE)) {
      try {
        const quotes = await yahooFinance.quote(batch.map(s => s.ticker), {
          return: 'array',
          fields: [
            'symbol',
            'shortName',
            'longName',
            'regularMarketPrice',
            'regularMarketChangePercent',
            'regularMarketVolume',
            'averageDailyVolume10Day',
            'averageDailyVolume3Month',
            'fiftyTwoWeekHigh',
            'fiftyTwoWeekLow',
          ] as any,
        } as any).catch(() => []);

        const bySymbol = new Map<string, any>();
        if (Array.isArray(quotes)) {
          for (const q of quotes) {
            if (q?.symbol) bySymbol.set(String(q.symbol).toUpperCase(), q);
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
            preScore: this.preScoreQuote(quote, signalFilter, setup),
          });
        }
      } catch {
        for (const retryBatch of this.chunks(batch, 10)) {
          await Promise.all(retryBatch.map(async (stock) => {
            const quote = await yahooFinance.quote(stock.ticker).catch(() => null);
            if (!quote || (quote as any).regularMarketPrice == null) {
              skipped.push(stock.ticker);
              return;
            }
            candidates.push({
              ...stock,
              quote,
              preScore: this.preScoreQuote(quote, signalFilter, setup),
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

    const limit = Math.min(candidates.length, Math.max(FAST_MIN_CANDIDATES, FAST_CANDIDATE_LIMIT));
    const sorted = [...candidates].sort((a, b) => b.preScore - a.preScore);
    const viable = sorted.filter(c => c.preScore > -100);
    return (viable.length >= FAST_MIN_CANDIDATES ? viable : sorted).slice(0, limit);
  }

  /** Run the IDX momentum scan and return a structured result + pre-rendered text. */
  async scan(
    sector: IdxSector = 'all',
    signalFilter: SignalFilter = 'buy',
    setup: SetupFilter = 'momentum',
    mode: ScanMode = 'fast',
  ): Promise<ScanResult> {
    const release = mode === 'deep' ? deepScanWorkloadGate.tryAcquire() : () => undefined;
    if (!release) throw new WorkloadBusyError('A deep IDX scan is already running');
    try {
    const universe = await this.getUniverse(sector);
    const results:  StockResult[] = [];
    const skipped:  string[] = [];
    const quoted = await this.fetchQuoteCandidates(universe, signalFilter, setup, skipped);
    const chartCandidates = this.selectChartCandidates(quoted, mode);

    log.info(
      'idx-scanner',
      `${mode} quote prefilter: ${chartCandidates.length}/${quoted.length} chart candidates from ${universe.length} universe`,
    );

    // Fetch in small concurrent batches — polite to Yahoo Finance
    const BATCH_SIZE = CHART_BATCH_SIZE;
    for (let i = 0; i < chartCandidates.length; i += BATCH_SIZE) {
      const batch = chartCandidates.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (stock) => {
        try {
          const quote = stock.quote;
          const chartResult = await yahooFinance.chart(stock.ticker, {
            period1:  new Date(Date.now() - 35 * 86_400_000),
            interval: '1d',
          }).catch(() => null);
          const history: any[] = chartResult?.quotes ?? [];

          if (!quote || (quote as any).regularMarketPrice == null) {
            skipped.push(stock.ticker);
            return;
          }

          const price   = (quote as any).regularMarketPrice        as number;
          const chg1d   = (quote as any).regularMarketChangePercent as number ?? 0;
          const high52w = (quote as any).fiftyTwoWeekHigh          as number | undefined;
          const low52w  = (quote as any).fiftyTwoWeekLow           as number | undefined;
          const vol     = (quote as any).regularMarketVolume        as number ?? 0;

          const closes: number[] = (Array.isArray(history) ? history : [])
            .map((d: any) => d.close as number)
            .filter((c: number) => c != null && isFinite(c));

          const chg5d  = closes.length >= 6
            ? ((price - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : 0;
          const chg20d = closes.length >= 21
            ? ((price - closes[closes.length - 21]) / closes[closes.length - 21]) * 100 : 0;

          const vols: number[] = (Array.isArray(history) ? history : [])
            .map((d: any) => d.volume as number)
            .filter((v: number) => v != null && v > 0);
          const avgVol20  = vols.length > 0
            ? vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(vols.length, 20) : 1;
          const volRatio  = avgVol20 > 0 ? vol / avgVol20 : 1;

          const from52wHigh = high52w != null && high52w > 0 ? ((price - high52w) / high52w) * 100 : 0;
          const from52wLow  = low52w  != null && low52w  > 0 ? ((price - low52w)  / low52w)  * 100 : 0;

          const score              = scoreStock(chg1d, chg5d, chg20d, volRatio, from52wHigh, from52wLow);
          const { signal, reason } = classifySignal(score, chg5d, chg1d, volRatio, from52wHigh, from52wLow);

          let setupType: SetupFilter | 'none' = 'none';
          if (from52wHigh > -5 && chg1d > 0 && volRatio > 1.5) setupType = 'breakout';
          else if (chg20d < -15) setupType = 'oversold';
          else if (from52wLow < 8 && chg1d > 0.5 && chg5d <= 2) setupType = 'rebound';
          else if (from52wLow < 3) setupType = 'all_time_low';
          else if (chg5d < -3 && chg20d < -5) setupType = 'downtrend';
          else if (score > 10) setupType = 'momentum';

          results.push({
            ticker: stock.ticker, name: stock.name, sector: stock.sector,
            price, chg1d, chg5d, chg20d, volRatio,
            from52wHigh, from52wLow, score, signal, reason, setupType,
          });

        } catch {
          skipped.push(stock.ticker);
        }
      }));

      if (i + BATCH_SIZE < chartCandidates.length) {
        await this.sleep(250);
      }
    }

    let finalResults = results;
    if (setup !== 'momentum') {
      finalResults = results.filter(r => r.setupType === setup);
      if (setup === 'rebound') finalResults.sort((a,b) => (b.chg1d * b.volRatio) - (a.chg1d * a.volRatio));
      if (setup === 'all_time_low') finalResults.sort((a,b) => a.from52wLow - b.from52wLow);
      if (setup === 'downtrend') finalResults.sort((a,b) => a.chg20d - b.chg20d);
      if (setup === 'breakout') finalResults.sort((a,b) => (b.chg1d * b.volRatio) - (a.chg1d * a.volRatio));
      if (setup === 'oversold') finalResults.sort((a,b) => a.chg20d - b.chg20d);

      finalResults.forEach((r, i) => {
        if (i < 8) { r.signal = 'BUY'; r.reason = `Top ${setup} match`; }
        else if (i < 14) { r.signal = 'WATCH'; r.reason = `Good ${setup} match`; }
        else { r.signal = 'AVOID'; }
      });
    } else {
      finalResults.sort((a, b) => b.score - a.score);
    }

    const allBuys   = finalResults.filter(r => r.signal === 'BUY');
    const allWatches = finalResults.filter(r => r.signal === 'WATCH');
    const allAvoids  = finalResults.filter(r => r.signal === 'AVOID');

    const filtered = signalFilter === 'sell' ? allAvoids
      : signalFilter === 'buy' ? [...allBuys, ...allWatches]
      : finalResults;

    const buys   = filtered.filter(r => r.signal === 'BUY').slice(0, 8);
    const watches = filtered.filter(r => r.signal === 'WATCH').slice(0, 6);
    const avoids  = filtered.filter(r => r.signal === 'AVOID').slice(0, 4);

    const avgScore = results.length > 0
      ? results.reduce((a, r) => a + r.score, 0) / results.length : 0;

    const breadthSignal =
      allBuys.length >= results.length * 0.4 ? 'BROAD RALLY — many stocks moving' :
      allBuys.length >= results.length * 0.2 ? 'SELECTIVE MOMENTUM — rotate carefully' :
      allAvoids.length >= results.length * 0.5 ? 'WEAK MARKET — few safe entries' :
      'MIXED — stock-picking environment';

    const formatted = this.format(
      sector,
      mode,
      universe.length,
      chartCandidates.length,
      results.length,
      buys,
      watches,
      avoids,
      skipped,
      avgScore,
      breadthSignal,
      signalFilter,
    );

    return {
      sector,
      mode,
      universeCount: universe.length,
      candidateCount: chartCandidates.length,
      totalScanned:  results.length,
      buyCount:      allBuys.length,
      watchCount:    allWatches.length,
      avoidCount:    allAvoids.length,
      avgScore,
      breadthSignal,
      buys, watches, avoids, skipped,
      formatted,
    };
    } finally {
      release();
    }
  }

  // ─── Pre-rendered text for agent observations ─────────────────────────────

  private fmt(n: number, sign = false): string {
    return (sign && n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  private format(
    sector:        string,
    mode:          ScanMode,
    universeCount: number,
    candidateCount:number,
    total:         number,
    buys:          StockResult[],
    watches:       StockResult[],
    avoids:        StockResult[],
    skipped:       string[],
    avgScore:      number,
    breadthSignal: string,
    signalFilter:  string,
  ): string {
    const lines: string[] = [
      `IDX MOMENTUM SCAN — ${sector.toUpperCase()} (${total} stocks scanned)`,
      '',
    ];

    lines[0] = `IDX MOMENTUM SCAN - ${sector.toUpperCase()} (${mode.toUpperCase()} mode)`;
    lines.splice(1, 0, `Universe: ${universeCount} stocks  |  quote-screened: ${candidateCount}  |  chart-scanned: ${total}`);

    if (buys.length === 0 && watches.length === 0) {
      lines.push('No strong momentum setups found right now.');
      lines.push('Market may be consolidating — consider waiting for a cleaner trigger.');
    } else {
      if (buys.length > 0) {
        lines.push('── BUY MOMENTUM (hidden movers, scored by strength) ──────────');
        for (const r of buys) {
          lines.push(`  [SCORE ${r.score.toFixed(0).padStart(3)}] ${r.ticker.replace('.JK', '')} · ${r.name} [${r.sector}]`);
          lines.push(`    price: IDR ${r.price.toLocaleString()}  1d: ${this.fmt(r.chg1d, true)}  5d: ${this.fmt(r.chg5d, true)}  20d: ${this.fmt(r.chg20d, true)}`);
          lines.push(`    vol: ${r.volRatio.toFixed(2)}x avg  |  from 52wH: ${r.from52wHigh.toFixed(1)}%  from 52wL: +${r.from52wLow.toFixed(1)}%`);
          lines.push(`    signal: ${r.reason}`);
          lines.push('');
        }
      }

      if (watches.length > 0) {
        lines.push('── WATCH LIST (momentum warming up) ─────────────────────────');
        for (const r of watches) {
          lines.push(
            `  [SCORE ${r.score.toFixed(0).padStart(3)}] ${r.ticker.replace('.JK', '')} · ${r.name}` +
            `  |  ${this.fmt(r.chg1d, true)} today  ${this.fmt(r.chg5d, true)} 5d` +
            `  |  vol ${r.volRatio.toFixed(2)}x  |  ${r.reason}`,
          );
        }
        lines.push('');
      }

      if (avoids.length > 0 && signalFilter === 'any') {
        lines.push('── AVOID (weak momentum / downtrend) ────────────────────────');
        for (const r of avoids) {
          lines.push(`  ${r.ticker.replace('.JK', '')} · ${r.name}  |  ${this.fmt(r.chg5d, true)} 5d  |  ${r.reason}`);
        }
        lines.push('');
      }
    }

    lines.push('── SECTOR BREADTH ───────────────────────────────────────────');
    lines.push(`  chart-scanned: ${total}  |  BUY: ${buys.length}  WATCH: ${watches.length}  AVOID: ${avoids.length}`);
    lines.push(`  avg momentum score: ${avgScore.toFixed(1)} / 100`);
    lines.push(`  breadth signal: ${breadthSignal}`);

    if (skipped.length > 0) {
      lines.push(`  (${skipped.length} tickers skipped: ${skipped.slice(0, 5).join(', ')})`);
    }

    return lines.join('\n');
  }
}

export const idxScannerService = new IdxScannerService();
