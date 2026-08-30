// ─── services/idx.universe.service.ts ────────────────────────────────────────
// Dynamically fetches the IDX (.JK) stock universe from a public GitHub dataset
// to ensure a completely unbiased, complete list of all active IDX stocks.
//
// Strategy:
//   1. Fetch sector-specific CSV lists from the Dataset-Saham-IDX repository
//   2. Parse and map them to BOZ sectors
//   3. Cache to the per-user BOZ configuration directory for 24h
//   4. Fall back to data/idx-universe.json if the fetch fails

import axios                         from 'axios';
import { readFileSync, writeFileSync,
         existsSync, renameSync,
         rmSync }                    from 'fs';
import { join, dirname }             from 'path';
import { fileURLToPath }             from 'url';
import { log }                       from '../../utils/logger.js';
import { ensureConfigDir }           from '../../utils/env-dir.js';
import { StockEntry }                from './idx.scanner.service.js';

// ─── Cache ────────────────────────────────────────────────────────────────────

const __dir      = dirname(fileURLToPath(import.meta.url));
const CACHE_TTL  = 24 * 60 * 60 * 1000; // 24 hours

export function idxUniverseCachePath(): string {
  return join(ensureConfigDir(), 'idx-universe-cache.json');
}

interface CacheFile {
  fetchedAt: number;
  stocks:    StockEntry[];
}

// ─── GitHub Dataset Source ───────────────────────────────────────────────────

const GITHUB_BASE_URL = 'https://raw.githubusercontent.com/wildangunawan/Dataset-Saham-IDX/master/List%20Emiten/Sectors';

const SECTOR_MAPPING: Record<string, string> = {
  'Financials':                 'banking',
  'Consumer Cyclicals':         'consumer',
  'Consumer Non-Cyclicals':     'consumer',
  'Basic Materials':            'mining',
  'Energy':                     'energy',
  'Technology':                 'tech',
  'Properties & Real Estate':   'property',
  'Infrastructures':            'telecom', // closest fit for telecom
  'Healthcare':                 'healthcare',
  'Industrials':                'industrial',
  'Transportation & Logistic':  'industrial', // merged into industrial
};

async function fetchSector(sectorFile: string, bozSector: string): Promise<StockEntry[]> {
  try {
    const url = `${GITHUB_BASE_URL}/${encodeURIComponent(sectorFile)}.csv`;
    const res = await axios.get<string>(url, {
      timeout: 10_000,
      maxContentLength: 2_000_000,
      responseType: 'text',
    });
    if (typeof res.data !== 'string') return [];
    const lines = (res.data as string).split('\n');
    
    const stocks: StockEntry[] = [];
    // skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      // CSV format: code,name,listingDate,shares,listingBoard
      const parts = line.split(',');
      if (parts.length >= 2) {
        const symbol = parts[0].trim().toUpperCase();
        if (!/^[A-Z0-9]{1,12}$/.test(symbol)) continue;
        const ticker = symbol + '.JK';
        const name = parts[1].trim();
        stocks.push({ ticker, name, sector: bozSector });
      }
    }
    return stocks;
  } catch (e) {
    log.warn('idx-universe', `Failed to fetch sector ${sectorFile}: ${(e as Error).message}`);
    return [];
  }
}

// ─── IdxUniverseService ───────────────────────────────────────────────────────

export class IdxUniverseService {

  private loadCache(): StockEntry[] | null {
    try {
      const cachePath = idxUniverseCachePath();
      if (!existsSync(cachePath)) return null;
      const raw  = readFileSync(cachePath, 'utf8');
      const data = JSON.parse(raw) as CacheFile;
      if (Date.now() - data.fetchedAt > CACHE_TTL) return null;
      if (!Array.isArray(data.stocks) || data.stocks.length < 20) return null;
      const ageMin = Math.round((Date.now() - data.fetchedAt) / 60_000);
      log.info('idx-universe', `cache hit — ${data.stocks.length} stocks (${ageMin}m ago)`);
      return data.stocks;
    } catch {
      return null;
    }
  }

  private saveCache(stocks: StockEntry[]): void {
    if (stocks.length === 0) return;
    const cachePath = idxUniverseCachePath();
    const temporaryPath = `${cachePath}.${process.pid}.tmp`;
    try {
      writeFileSync(
        temporaryPath,
        JSON.stringify({ fetchedAt: Date.now(), stocks }, null, 2),
        { encoding: 'utf8', mode: 0o600, flag: 'w' },
      );
      renameSync(temporaryPath, cachePath);
      log.info('idx-universe', `cache saved — ${stocks.length} stocks`);
    } catch (e) {
      rmSync(temporaryPath, { force: true });
      log.warn('idx-universe', `cache write failed: ${(e as Error).message}`);
    }
  }

  private getStaticFallback(): StockEntry[] {
    try {
      const fallbackPath = join(__dir, '../../data/idx-universe.json');
      if (!existsSync(fallbackPath)) return [];
      const raw = readFileSync(fallbackPath, 'utf8');
      const data = JSON.parse(raw) as Record<string, StockEntry[]>;
      const seen = new Set<string>();
      return Object.values(data).flat().filter(s => {
        if (seen.has(s.ticker)) return false;
        seen.add(s.ticker);
        return true;
      });
    } catch (e) {
      log.warn('idx-universe', `fallback load failed: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * Returns the live IDX universe.
   *
   * First call: fetches from GitHub dataset.
   * Subsequent calls within 24h: serves from cache instantly.
   *
   * @param forceRefresh  bypass cache and re-fetch
   */
  async getUniverse(forceRefresh = false): Promise<StockEntry[]> {
    if (!forceRefresh) {
      const cached = this.loadCache();
      if (cached) return cached;
    }

    log.info('idx-universe', 'fetching live universe from public datasets…');

    const fetchPromises = Object.entries(SECTOR_MAPPING).map(([file, sector]) => fetchSector(file, sector));
    const results = await Promise.all(fetchPromises);
    
    const merged: StockEntry[] = results.flat();
    log.info('idx-universe', `fetched ${merged.length} stocks across all sectors`);

    if (merged.length < 20) {
      log.warn('idx-universe', 'dataset fetch failed or returned too few stocks — using JSON fallback');
      const fallback = this.getStaticFallback();
      this.saveCache(fallback);
      return fallback;
    }

    this.saveCache(merged);
    return merged;
  }

  filterBySector(stocks: StockEntry[], sector: string): StockEntry[] {
    if (sector === 'all') return stocks;
    return stocks.filter(s => s.sector === sector);
  }
}

export const idxUniverseService = new IdxUniverseService();
