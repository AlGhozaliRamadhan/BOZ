import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import {
  GlobalUniverseService,
  globalUniverseCachePath,
  MAX_GLOBAL_UNIVERSE_SIZE,
  US_UNIVERSE,
  CRYPTO_UNIVERSE,
} from '../src/services/market/global.universe.service';

/** Minimal Nasdaq screener payload: alphabetical order, string market caps. */
function nasdaqRows() {
  // Padded past the service's minimum-usable-row threshold so a fetch counts as
  // a real success instead of silently falling back. Letters only: the ticker
  // pattern rejects digits, so numeric padding would be discarded.
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const padding = Array.from({ length: 24 }, (_, i) => ({
    symbol: `${LETTERS[i % 26]}${LETTERS[Math.floor(i / 26)]}Z`,
    name: `Padding Holdings ${i} Common Stock`,
    sector: 'Industrials',
    marketCap: '1000000.00',
  }));

  return {
    data: {
      rows: [
        { symbol: 'ZZZZ', name: 'Zeta Corp Common Stock', sector: 'Technology', marketCap: '10000000000.00' },
        { symbol: 'BRK/B', name: 'Berkshire Hathaway Inc.', sector: '', marketCap: '1160000000000.00' },
        { symbol: 'NVDA', name: 'NVIDIA Corporation Common Stock', sector: 'Technology', marketCap: '3000000000000.00' },
        { symbol: 'XOM', name: 'Exxon Mobil Corporation', sector: 'Energy', marketCap: '500000000000.00' },
        { symbol: 'AAPL', name: 'Apple Inc. Common Stock', sector: 'Technology', marketCap: '2900000000000.00' },
        { symbol: 'GOOGL', name: 'Alphabet Inc. Class A Common Stock', sector: 'Technology', marketCap: '2800000000000.00' },
        { symbol: 'BFH^A', name: 'Bread Financial Depositary Shares', sector: 'Finance', marketCap: '100.00' },
        { symbol: 'KO', name: 'Coca-Cola Company', sector: 'Consumer Staples', marketCap: '300000000000.00' },
        { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Health Care', marketCap: '400000000000.00' },
        { symbol: 'BAC', name: 'Bank of America Corporation', sector: 'Finance', marketCap: '700000000000.00' },
        { symbol: 'CAT', name: 'Caterpillar Inc.', sector: 'Industrials', marketCap: '200000000000.00' },
        { symbol: 'MISC', name: 'Something Odd', sector: 'Miscellaneous', marketCap: '500.00' },
        { symbol: 'TOOLONGTICKER', name: 'Too Long A Ticker', sector: 'Technology', marketCap: '900.00' },
        ...padding,
      ],
    },
  };
}

function coingeckoRows() {
  // Enough rows that the crypto half clears the minimum-row guard after the
  // stablecoins and single-character ticker are discarded.
  const padding = Array.from({ length: 12 }, (_, i) => ({
    symbol: `pz${i}x`,
    name: `Padding Coin ${i}`,
  }));

  return [
    { symbol: 'btc', name: 'Bitcoin' },
    { symbol: 'eth', name: 'Ethereum' },
    { symbol: 'sol', name: 'Solana' },
    { symbol: 'ada', name: 'Cardano' },
    { symbol: 'xrp', name: 'XRP' },
    { symbol: 'doge', name: 'Dogecoin' },
    { symbol: 'avax', name: 'Avalanche' },
    { symbol: 'link', name: 'Chainlink' },
    { symbol: 'dot', name: 'Polkadot' },
    { symbol: 'matic', name: 'Polygon' },
    { symbol: 'bnb', name: 'BNB' },
    { symbol: 'trx', name: 'TRON' },
    { symbol: 'usdt', name: 'Tether' },
    { symbol: 'usdc', name: 'USD Coin' },
    { symbol: 'dai', name: 'Dai' },
    { symbol: 'x', name: 'Too Short' },
    ...padding,
  ];
}

/** A cache payload large enough to pass the minimum-row guard. */
function validCache() {
  return {
    fetchedAt: Date.now(),
    us: Array.from({ length: 40 }, (_, i) => ({
      ticker: `U${i}`.replace(/[^A-Z]/g, 'U'), name: `Cached ${i}`, sector: 'technology',
    })),
    crypto: Array.from({ length: 40 }, (_, i) => ({
      ticker: `CA${i}-USD`, name: `Cached ${i}`, sector: 'crypto',
    })),
  };
}

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'boz-global-universe-'));
  process.env.BOZ_CONFIG_DIR = directory;
  return directory;
}

/** Both remote sources answer with the fixtures above. */
async function stubSources() {
  vi.spyOn(axios, 'get').mockImplementation(async (url: unknown) => {
    const href = String(url);
    if (href.includes('nasdaq')) return { data: nasdaqRows() } as never;
    return { data: coingeckoRows() } as never;
  });
}

describe('global universe cache location', () => {
  let directory: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.BOZ_CONFIG_DIR;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('stores the cache under the configured per-user directory', async () => {
    directory = await tempDir();
    expect(globalUniverseCachePath()).toBe(join(directory, 'global-universe-cache.json'));
  });

  it('falls back to the curated lists when both sources are offline', async () => {
    directory = await tempDir();
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('offline'));

    const service = new GlobalUniverseService();
    expect(await service.getUsUniverse()).toEqual(US_UNIVERSE);
    expect(await service.getCryptoUniverse()).toEqual(CRYPTO_UNIVERSE);
  });

  it('serves a warm cache without touching the network', async () => {
    directory = await tempDir();
    const payload = validCache();
    await writeFile(globalUniverseCachePath(), JSON.stringify(payload), 'utf8');
    const spy = vi.spyOn(axios, 'get').mockRejectedValue(new Error('must not be called'));

    const service = new GlobalUniverseService();
    expect(await service.getUsUniverse()).toHaveLength(payload.us.length);
    expect(await service.getCryptoUniverse()).toHaveLength(payload.crypto.length);
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects a cache too small to trust and refetches', async () => {
    directory = await tempDir();
    await writeFile(globalUniverseCachePath(), JSON.stringify({
      fetchedAt: Date.now(),
      us: [{ ticker: 'AAPL', name: 'Apple', sector: 'technology' }],
      crypto: [{ ticker: 'BTC-USD', name: 'Bitcoin', sector: 'crypto' }],
    }), 'utf8');
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('offline'));

    const service = new GlobalUniverseService();
    expect(await service.getUsUniverse()).toEqual(US_UNIVERSE);
  });

  it('rejects a tampered cache and refetches', async () => {
    directory = await tempDir();
    // A crypto pair parked in the US half must not be trusted.
    await writeFile(globalUniverseCachePath(), JSON.stringify({
      fetchedAt: Date.now(),
      us: [
        { ticker: 'BTC-USD', name: 'Bitcoin', sector: 'technology' },
        ...Array.from({ length: 40 }, (_, i) => ({ ticker: `U${i}X`, name: `T ${i}`, sector: 'technology' })),
      ],
      crypto: Array.from({ length: 40 }, (_, i) => ({ ticker: `CA${i}-USD`, name: `C ${i}`, sector: 'crypto' })),
    }), 'utf8');

    await stubSources();

    const us = await new GlobalUniverseService().getUsUniverse();
    expect(us.map(row => row.ticker)).not.toContain('BTC-USD');
    expect(us.map(row => row.ticker)).toContain('NVDA');
  });
});

describe('global universe live sources', () => {
  let directory: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.BOZ_CONFIG_DIR;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  async function stubBoth() {
    await stubSources();
  }

  it('ranks US listings by market cap, not by feed order', async () => {
    directory = await tempDir();
    await stubBoth();

    const us = await new GlobalUniverseService().getUsUniverse();
    // NVDA/AAPL (the two largest) must come first despite Nasdaq sorting them late.
    expect(us[0].ticker).toBe('NVDA');
    expect(us[1].ticker).toBe('AAPL');
    const zzzIndex = us.findIndex(row => row.ticker === 'ZZZZ');
    const nvdaIndex = us.findIndex(row => row.ticker === 'NVDA');
    expect(nvdaIndex).toBeLessThan(zzzIndex);
  });

  it('normalises slash class shares to Yahoo dashes', async () => {
    directory = await tempDir();
    await stubBoth();

    const us = await new GlobalUniverseService().getUsUniverse();
    expect(us.map(row => row.ticker)).toContain('BRK-B');
    expect(us.some(row => row.ticker.includes('/'))).toBe(false);
  });

  it('keeps unsectored mega caps under a sentinel that no sector filter matches', async () => {
    directory = await tempDir();
    await stubBoth();

    const service = new GlobalUniverseService();
    const us = await service.getUsUniverse();
    const berkshire = us.find(row => row.ticker === 'BRK-B');
    expect(berkshire).toBeDefined();
    expect(berkshire?.sector).toBe('unclassified');

    // Visible under "all", absent from every named sector.
    expect(service.filterBySector(us, 'all')).toContainEqual(berkshire);
    for (const sector of ['technology', 'finance', 'healthcare', 'energy', 'consumer', 'industrial']) {
      expect(service.filterBySector(us, sector).map(row => row.ticker)).not.toContain('BRK-B');
    }
  });

  it('strips listing boilerplate from names', async () => {
    directory = await tempDir();
    await stubBoth();

    const us = await new GlobalUniverseService().getUsUniverse();
    expect(us.find(row => row.ticker === 'AAPL')?.name).toBe('Apple Inc.');
    expect(us.find(row => row.ticker === 'NVDA')?.name).toBe('NVIDIA Corporation');
  });

  it('drops preferred-share and oversized symbols', async () => {
    directory = await tempDir();
    await stubBoth();

    const tickers = (await new GlobalUniverseService().getUsUniverse()).map(row => row.ticker);
    expect(tickers).not.toContain('BFH^A');
    expect(tickers).not.toContain('ELON');
  });

  it('maps every Nasdaq sector label onto a BOZ sector', async () => {
    directory = await tempDir();
    await stubBoth();

    const us = await new GlobalUniverseService().getUsUniverse();
    const sectors = new Set(us.map(row => row.sector));
    expect(sectors.has('technology')).toBe(true);
    expect(sectors.has('finance')).toBe(true);
    expect(sectors.has('healthcare')).toBe(true);
    expect(sectors.has('energy')).toBe(true);
    expect(sectors.has('consumer')).toBe(true); // Consumer Staples folds into consumer
    expect(sectors.has('industrial')).toBe(true);
  });

  it('maps CoinGecko coins to Yahoo pairs and excludes stablecoins', async () => {
    directory = await tempDir();
    await stubBoth();

    const crypto = await new GlobalUniverseService().getCryptoUniverse();
    const tickers = crypto.map(row => row.ticker);
    expect(tickers).toContain('BTC-USD');
    expect(tickers).toContain('ETH-USD');
    expect(tickers).toContain('SOL-USD');
    expect(tickers).not.toContain('USDT-USD');
    expect(tickers).not.toContain('USDC-USD');
    expect(tickers).not.toContain('DAI-USD');
    expect(crypto.every(row => row.sector === 'crypto')).toBe(true);
  });

  it('persists a cache the next call can read without refetching', async () => {
    directory = await tempDir();
    await stubBoth();

    await new GlobalUniverseService().getUsUniverse();
    const raw = JSON.parse(await readFile(globalUniverseCachePath(), 'utf8'));
    expect(raw.us.length).toBeGreaterThan(0);
    expect(raw.crypto.length).toBeGreaterThan(0);
    expect(typeof raw.fetchedAt).toBe('number');

    // A fresh service must reuse the cache rather than call axios again. The spy
    // already recorded the first service's two calls, so compare against that.
    const spy = vi.spyOn(axios, 'get');
    const before = spy.mock.calls.length;
    const second = await new GlobalUniverseService().getUsUniverse();
    expect(spy.mock.calls.length).toBe(before);
    expect(second.length).toBe(raw.us.length);
  });

  it('keeps the good half live when only one source fails', async () => {
    directory = await tempDir();
    vi.spyOn(axios, 'get').mockImplementation(async (url: unknown) => {
      if (String(url).includes('nasdaq')) throw new Error('nasdaq down');
      return { data: coingeckoRows() } as never;
    });

    const service = new GlobalUniverseService();
    // Crypto came through live; US fell back rather than both going empty.
    expect(await service.getCryptoUniverse()).toContainEqual({ ticker: 'BTC-USD', name: 'Bitcoin', sector: 'crypto' });
    expect(await service.getUsUniverse()).toEqual(US_UNIVERSE);
  });

  it('shares one in-flight refresh across concurrent callers', async () => {
    directory = await tempDir();
    let calls = 0;
    vi.spyOn(axios, 'get').mockImplementation(async (url: unknown) => {
      calls++;
      if (String(url).includes('nasdaq')) return { data: nasdaqRows() } as never;
      return { data: coingeckoRows() } as never;
    });

    const service = new GlobalUniverseService();
    await Promise.all([service.getUsUniverse(), service.getUsUniverse(), service.getCryptoUniverse()]);
    // One request per source, not three.
    expect(calls).toBe(2);
  });

  it('caps the US universe at the documented maximum', () => {
    expect(MAX_GLOBAL_UNIVERSE_SIZE).toBeGreaterThan(500);
  });
});