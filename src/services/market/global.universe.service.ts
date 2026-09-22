// ─── services/global.universe.service.ts ─────────────────────────────────────
// Curated global screener universe (US large caps + crypto) for the
// non-IDX screener tab. Static list keeps scans fast and deterministic;
// Yahoo Finance provides quotes/charts for every symbol below.

import type { StockEntry } from './idx.scanner.service.js';

export const MAX_GLOBAL_UNIVERSE_SIZE = 200;

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

export const US_UNIVERSE: StockEntry[] = GLOBAL_UNIVERSE.filter(stock => stock.sector !== 'crypto');

export const CRYPTO_UNIVERSE: StockEntry[] = GLOBAL_UNIVERSE.filter(stock => stock.sector === 'crypto');

export class GlobalUniverseService {
  async getUniverse(): Promise<StockEntry[]> {
    return GLOBAL_UNIVERSE.slice(0, MAX_GLOBAL_UNIVERSE_SIZE);
  }

  async getUsUniverse(): Promise<StockEntry[]> {
    return US_UNIVERSE.slice(0, MAX_GLOBAL_UNIVERSE_SIZE);
  }

  async getCryptoUniverse(): Promise<StockEntry[]> {
    return CRYPTO_UNIVERSE.slice(0, MAX_GLOBAL_UNIVERSE_SIZE);
  }

  filterBySector(stocks: StockEntry[], sector: string): StockEntry[] {
    if (sector === 'all') return stocks.slice(0, MAX_GLOBAL_UNIVERSE_SIZE);
    return stocks.filter(stock => stock.sector === sector).slice(0, MAX_GLOBAL_UNIVERSE_SIZE);
  }
}

export const globalUniverseService = new GlobalUniverseService();
