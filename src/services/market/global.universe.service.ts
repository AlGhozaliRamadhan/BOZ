// ─── services/global.universe.service.ts ─────────────────────────────────────
// Screener universe for the non-IDX tabs (US equities + crypto).
//
// This used to be a static list of ~54 US names and 8 crypto pairs, which put
// a hard ceiling on the whole board: the scanner could never return more rows
// than the hardcoded list contained. Both halves are now fetched, validated and
// cached exactly like the IDX universe:
//
//   1. US equities — Nasdaq's public listing screener (thousands of tickers,
//      carrying sector and market cap so the sector filters and the liquidity
//      prefilter both keep working).
//   2. Crypto — CoinGecko top coins by market cap, mapped to Yahoo `SYM-USD`.
//   3. Cache to the per-user config directory for 24h.
//   4. Fall back to the curated list below when a fetch fails.
//
// Yahoo's own /v1/finance/screener is deliberately NOT used: every predefined
// screen returns zero rows against the current endpoint.

import axios from 'axios';
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, statSync } from 'fs';
import { join } from 'path';
import { log } from '../../utils/logger.js';
import { ensureConfigDir } from '../../utils/env-dir.js';
import type { StockEntry } from './idx.scanner.service.js';

const CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = 4_000_000;
const FETCH_TIMEOUT_MS = 15_000;
/** Below this the fetch is treated as a failure and the fallback is used. */
const MIN_UNIVERSE_ROWS = 20;

export const MAX_GLOBAL_UNIVERSE_SIZE = 1_000;
export const MAX_CRYPTO_UNIVERSE_SIZE = 250;

export type GlobalSector =
  | 'all'
  | 'technology'
  | 'finance'
  | 'healthcare'
  | 'energy'
  | 'consumer'
  | 'industrial'
  | 'crypto';

export const GLOBAL_SECTORS: Array<{ value: GlobalSector; label: string }> = [
  { value: 'all', label: 'All markets' },
  { value: 'technology', label: 'Technology' },
  { value: 'finance', label: 'Finance' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'energy', label: 'Energy' },
  { value: 'consumer', label: 'Consumer' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'crypto', label: 'Crypto' },
];

/** Nasdaq's GICS-style labels mapped onto the seven BOZ screener sectors.
 *  Anything outside this map (Miscellaneous, blank) is tagged UNCLASSIFIED_SECTOR
 *  rather than dropped or guessed: such rows still surface under "All", and a
 *  specific-sector filter never matches the sentinel, so Berkshire and the other
 *  handful of unsectored mega caps stay visible without being mislabelled. */
const UNCLASSIFIED_SECTOR = 'unclassified';

const NASDAQ_SECTOR_MAP: Record<string, GlobalSector> = {
  'Technology': 'technology',
  'Finance': 'finance',
  'Health Care': 'healthcare',
  'Energy': 'energy',
  'Consumer Discretionary': 'consumer',
  'Consumer Staples': 'consumer',
  'Industrials': 'industrial',
  'Basic Materials': 'industrial',
  'Real Estate': 'finance',
  'Utilities': 'energy',
  'Telecommunications': 'technology',
};

const NASDAQ_URL = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/coins/markets'
  + '?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false';

// ─── Curated fallback (only used when a fetch fails) ──────────────────────────

const GLOBAL_UNIVERSE: StockEntry[] = [
  // Technology
  { ticker: 'AAPL', name: 'Apple', sector: 'technology' },
  { ticker: 'MSFT', name: 'Microsoft', sector: 'technology' },
  { ticker: 'NVDA', name: 'NVIDIA', sector: 'technology' },
  { ticker: 'GOOGL', name: 'Alphabet', sector: 'technology' },
  { ticker: 'META', name: 'Meta Platforms', sector: 'technology' },
  { ticker: 'AVGO', name: 'Broadcom', sector: 'technology' },
  { ticker: 'ORCL', name: 'Oracle', sector: 'technology' },
  { ticker: 'AMD', name: 'Advanced Micro Devices', sector: 'technology' },
  { ticker: 'CRM', name: 'Salesforce', sector: 'technology' },
  { ticker: 'ADBE', name: 'Adobe', sector: 'technology' },
  { ticker: 'TSM', name: 'Taiwan Semiconductor', sector: 'technology' },
  { ticker: 'ASML', name: 'ASML Holding', sector: 'technology' },
  // Finance
  { ticker: 'JPM', name: 'JPMorgan Chase', sector: 'finance' },
  { ticker: 'V', name: 'Visa', sector: 'finance' },
  { ticker: 'MA', name: 'Mastercard', sector: 'finance' },
  { ticker: 'BAC', name: 'Bank of America', sector: 'finance' },
  { ticker: 'GS', name: 'Goldman Sachs', sector: 'finance' },
  { ticker: 'BRK-B', name: 'Berkshire Hathaway', sector: 'finance' },
  { ticker: 'WFC', name: 'Wells Fargo', sector: 'finance' },
  { ticker: 'MS', name: 'Morgan Stanley', sector: 'finance' },
  // Healthcare
  { ticker: 'UNH', name: 'UnitedHealth', sector: 'healthcare' },
  { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'healthcare' },
  { ticker: 'LLY', name: 'Eli Lilly', sector: 'healthcare' },
  { ticker: 'PFE', name: 'Pfizer', sector: 'healthcare' },
  { ticker: 'MRK', name: 'Merck', sector: 'healthcare' },
  { ticker: 'ABBV', name: 'AbbVie', sector: 'healthcare' },
  { ticker: 'TMO', name: 'Thermo Fisher', sector: 'healthcare' },
  { ticker: 'AMGN', name: 'Amgen', sector: 'healthcare' },
  // Energy
  { ticker: 'XOM', name: 'Exxon Mobil', sector: 'energy' },
  { ticker: 'CVX', name: 'Chevron', sector: 'energy' },
  { ticker: 'SHEL', name: 'Shell', sector: 'energy' },
  { ticker: 'TTE', name: 'TotalEnergies', sector: 'energy' },
  { ticker: 'COP', name: 'ConocoPhillips', sector: 'energy' },
  { ticker: 'EOG', name: 'EOG Resources', sector: 'energy' },
  { ticker: 'MPC', name: 'Marathon Petroleum', sector: 'energy' },
  { ticker: 'OXY', name: 'Occidental Petroleum', sector: 'energy' },
  // Consumer
  { ticker: 'AMZN', name: 'Amazon', sector: 'consumer' },
  { ticker: 'TSLA', name: 'Tesla', sector: 'consumer' },
  { ticker: 'HD', name: 'Home Depot', sector: 'consumer' },
  { ticker: 'MCD', name: "McDonald's", sector: 'consumer' },
  { ticker: 'NKE', name: 'Nike', sector: 'consumer' },
  { ticker: 'SBUX', name: 'Starbucks', sector: 'consumer' },
  { ticker: 'KO', name: 'Coca-Cola', sector: 'consumer' },
  { ticker: 'PEP', name: 'PepsiCo', sector: 'consumer' },
  { ticker: 'WMT', name: 'Walmart', sector: 'consumer' },
  { ticker: 'COST', name: 'Costco', sector: 'consumer' },
  // Industrial
  { ticker: 'GE', name: 'GE Aerospace', sector: 'industrial' },
  { ticker: 'CAT', name: 'Caterpillar', sector: 'industrial' },
  { ticker: 'HON', name: 'Honeywell', sector: 'industrial' },
  { ticker: 'UNP', name: 'Union Pacific', sector: 'industrial' },
  { ticker: 'BA', name: 'Boeing', sector: 'industrial' },
  { ticker: 'RTX', name: 'RTX', sector: 'industrial' },
  { ticker: 'LMT', name: 'Lockheed Martin', sector: 'industrial' },
  { ticker: 'DE', name: 'Deere', sector: 'industrial' },
  // Crypto (24/7)
  { ticker: 'BTC-USD', name: 'Bitcoin', sector: 'crypto' },
  { ticker: 'ETH-USD', name: 'Ethereum', sector: 'crypto' },
  { ticker: 'SOL-USD', name: 'Solana', sector: 'crypto' },
  { ticker: 'BNB-USD', name: 'BNB', sector: 'crypto' },
  { ticker: 'XRP-USD', name: 'XRP', sector: 'crypto' },
  { ticker: 'DOGE-USD', name: 'Dogecoin', sector: 'crypto' },
  { ticker: 'ADA-USD', name: 'Cardano', sector: 'crypto' },
  { ticker: 'AVAX-USD', name: 'Avalanche', sector: 'crypto' },
];

const FALLBACK_US = GLOBAL_UNIVERSE.filter(stock => stock.sector !== 'crypto');
const FALLBACK_CRYPTO = GLOBAL_UNIVERSE.filter(stock => stock.sector === 'crypto');

export const US_UNIVERSE: StockEntry[] = FALLBACK_US;
export const CRYPTO_UNIVERSE: StockEntry[] = FALLBACK_CRYPTO;

// ─── Cache ────────────────────────────────────────────────────────────────────

export function globalUniverseCachePath(): string {
  return join(ensureConfigDir(), 'global-universe-cache.json');
}

interface CacheFile {
  fetchedAt: number;
  us: StockEntry[];
  crypto: StockEntry[];
}

/** Yahoo equity tickers: up to 5 uppercase letters (GOOGL, MSFT) plus an
 *  optional single-letter class suffix (`BRK-B`). Nasdaq spells the same share
 *  class with a slash (`BRK/B`), so the raw symbol is normalized first. */
const US_TICKER = /^[A-Z]{1,5}(?:-[A-Z])?$/;
/** Yahoo crypto pairs are `BASE-USD`. */
const CRYPTO_TICKER = /^[A-Z0-9]{2,12}-USD$/;

function isValidEntry(stock: unknown, tickerPattern: RegExp): stock is StockEntry {
  if (!stock || typeof stock !== 'object') return false;
  const row = stock as Record<string, unknown>;
  return typeof row.ticker === 'string'
    && tickerPattern.test(row.ticker)
    && typeof row.name === 'string'
    && row.name.length > 0
    && row.name.length <= 200
    && typeof row.sector === 'string'
    && row.sector.length > 0
    && row.sector.length <= 40;
}

function sanitize(rows: StockEntry[], tickerPattern: RegExp): StockEntry[] {
  const seen = new Set<string>();
  const out: StockEntry[] = [];
  for (const row of rows) {
    if (!isValidEntry(row, tickerPattern) || seen.has(row.ticker)) continue;
    seen.add(row.ticker);
    out.push({ ticker: row.ticker, name: row.name.trim(), sector: row.sector });
  }
  return out;
}

/** Strip listing boilerplate: "Apple Inc. Common Stock" → "Apple Inc.". */
function cleanListingName(raw: unknown, fallback: string): string {
  return String(raw ?? '')
    .replace(/\s+(Common Stock|Class [A-Z]|Ordinary Shares?|Depositary Shares?)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || fallback;
}

/** Nasdaq reports marketCap as a plain decimal string, sometimes empty. */
function parseMarketCap(raw: unknown): number {
  const parsed = Number.parseFloat(String(raw ?? '').replace(/[$,]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Pegged assets never produce a real momentum reading, so they are not candidates. */
const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD', 'USDD', 'PYUSD', 'EURT', 'EURS']);

// ─── Remote sources ───────────────────────────────────────────────────────────

async function fetchUsUniverse(): Promise<StockEntry[]> {
  const res = await axios.get<unknown>(NASDAQ_URL, {
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: MAX_CACHE_BYTES,
    responseType: 'json',
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  });

  const rows = (res.data as { data?: { rows?: unknown[] } })?.data?.rows;
  if (!Array.isArray(rows)) throw new Error('Nasdaq screener returned no rows');

  const entries: Array<StockEntry & { marketCap: number }> = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    // `BRK/B` is Yahoo's `BRK-B`.
    const symbol = String(row.symbol ?? '').trim().toUpperCase().replace(/\//g, '-');
    if (!US_TICKER.test(symbol)) continue;

    const sector = NASDAQ_SECTOR_MAP[String(row.sector ?? '').trim()] ?? UNCLASSIFIED_SECTOR;

    entries.push({
      ticker: symbol,
      name: cleanListingName(row.name, symbol),
      sector,
      marketCap: parseMarketCap(row.marketCap),
    });
  }

  // Nasdaq returns listings alphabetically, so an unsorted slice would keep only
  // the A–D names and silently drop NVDA, TSLA, MSFT and META. Rank by market
  // cap instead: the truncated set is then the most liquid, investable names.
  entries.sort((left, right) => right.marketCap - left.marketCap);

  const clean = sanitize(
    entries.map(({ ticker, name, sector }) => ({ ticker, name, sector })),
    US_TICKER,
  );
  if (clean.length < MIN_UNIVERSE_ROWS) {
    throw new Error(`Nasdaq screener yielded only ${clean.length} usable rows`);
  }
  return clean;
}

async function fetchCryptoUniverse(): Promise<StockEntry[]> {
  const res = await axios.get<unknown>(COINGECKO_URL, {
    timeout: FETCH_TIMEOUT_MS,
    maxContentLength: MAX_CACHE_BYTES,
    responseType: 'json',
    headers: { Accept: 'application/json' },
  });

  if (!Array.isArray(res.data)) throw new Error('CoinGecko returned no rows');

  const entries: StockEntry[] = [];
  for (const raw of res.data) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const base = String(row.symbol ?? '').trim().toUpperCase();
    // Yahoo pairs need a 2-12 character base.
    if (!/^[A-Z0-9]{2,12}$/.test(base)) continue;
    if (STABLECOINS.has(base)) continue;
    const name = String(row.name ?? '').trim() || base;
    entries.push({ ticker: `${base}-USD`, name, sector: 'crypto' });
  }

  const clean = sanitize(entries, CRYPTO_TICKER);
  if (clean.length < MIN_UNIVERSE_ROWS) {
    throw new Error(`CoinGecko yielded only ${clean.length} usable coins`);
  }
  return clean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class GlobalUniverseService {
  private cached: CacheFile | null = null;
  private inflight: Promise<CacheFile> | null = null;

  private loadCache(): CacheFile | null {
    try {
      const cachePath = globalUniverseCachePath();
      if (!existsSync(cachePath)) return null;
      if (statSync(cachePath).size > MAX_CACHE_BYTES) return null;

      const data = JSON.parse(readFileSync(cachePath, 'utf8')) as CacheFile;
      if (Date.now() - data.fetchedAt > CACHE_TTL) return null;
      if (!Array.isArray(data.us) || !Array.isArray(data.crypto)) return null;
      if (data.us.length < MIN_UNIVERSE_ROWS || data.crypto.length < MIN_UNIVERSE_ROWS) return null;
      if (!data.us.every(row => isValidEntry(row, US_TICKER))) return null;
      if (!data.crypto.every(row => isValidEntry(row, CRYPTO_TICKER))) return null;
      return data;
    } catch {
      return null;
    }
  }

  private saveCache(data: CacheFile): void {
    const cachePath = globalUniverseCachePath();
    const temporaryPath = `${cachePath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(data, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'w',
      });
      renameSync(temporaryPath, cachePath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      log.warn('global-universe', `cache write failed: ${(error as Error).message}`);
    }
  }

  /**
   * A partial refresh keeps whichever half succeeded live and falls back only
   * the half that did not, so one dead source cannot shrink both markets.
   */
  private async refresh(): Promise<CacheFile> {
    const [us, crypto] = await Promise.all([
      fetchUsUniverse().catch((error: unknown) => {
        log.warn('global-universe', `US universe fetch failed: ${(error as Error).message}`);
        return null;
      }),
      fetchCryptoUniverse().catch((error: unknown) => {
        log.warn('global-universe', `crypto universe fetch failed: ${(error as Error).message}`);
        return null;
      }),
    ]);

    const data: CacheFile = {
      fetchedAt: Date.now(),
      us: (us ?? this.cached?.us ?? FALLBACK_US).slice(0, MAX_GLOBAL_UNIVERSE_SIZE),
      crypto: (crypto ?? this.cached?.crypto ?? FALLBACK_CRYPTO).slice(0, MAX_CRYPTO_UNIVERSE_SIZE),
    };

    // Only persist when a live fetch actually contributed something.
    if (us || crypto) {
      this.saveCache(data);
      log.info('global-universe', `universe refreshed: ${data.us.length} US · ${data.crypto.length} crypto`);
    }
    this.cached = data;
    return data;
  }

  /** A single in-flight refresh shared by every concurrent caller. */
  private universe(forceRefresh = false): Promise<CacheFile> {
    if (!forceRefresh) {
      const disk = this.loadCache();
      if (disk) {
        this.cached = disk;
        return Promise.resolve(disk);
      }
      if (this.cached) return Promise.resolve(this.cached);
    }
    this.inflight ??= this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  async getUniverse(): Promise<StockEntry[]> {
    const data = await this.universe();
    return [...data.us, ...data.crypto];
  }

  async getUsUniverse(): Promise<StockEntry[]> {
    const data = await this.universe();
    return data.us;
  }

  async getCryptoUniverse(): Promise<StockEntry[]> {
    const data = await this.universe();
    return data.crypto;
  }

  filterBySector(stocks: StockEntry[], sector: string): StockEntry[] {
    if (sector === 'all') return stocks.slice(0, MAX_GLOBAL_UNIVERSE_SIZE);
    return stocks.filter(stock => stock.sector === sector).slice(0, MAX_GLOBAL_UNIVERSE_SIZE);
  }
}

export const globalUniverseService = new GlobalUniverseService();