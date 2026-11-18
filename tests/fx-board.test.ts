import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({
  log: {
    data: vi.fn(), ok: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  },
}));

import { FxService } from '../src/services/market/fx.service.js';
import { yahooFinance } from '../src/services/market/yahoo.service.js';
import { FX_PAIRS } from '../src/shared/fx.js';

/** Board quotes for whatever symbols the service asked for. */
function mockProvider() {
  return vi.spyOn(yahooFinance, 'quote').mockImplementation((async (symbols: unknown) => {
    if (Array.isArray(symbols)) {
      return symbols.map((symbol, index) => ({
        symbol,
        shortName: String(symbol),
        regularMarketPrice: 1 + index / 100,
        regularMarketPreviousClose: 1,
        regularMarketChangePercent: 0.5,
        regularMarketTime: 1_700_000_000,
        marketState: 'REGULAR',
      }));
    }
    if (symbols === 'DX-Y.NYB') {
      return {
        regularMarketPrice: 104.25,
        regularMarketChangePercent: 0.31,
      };
    }
    return null;
  }) as any);
}

describe('FxService board', () => {
  afterEach(() => vi.restoreAllMocks());

  it('batches the whole registry and keeps registry order', async () => {
    const quote = mockProvider();
    const service = new FxService();

    const board = await service.getBoard();

    expect(board.map(row => row.code)).toEqual(FX_PAIRS.map(pair => pair.code));
    // One quote batch per 20 symbols, not one call per pair.
    const expectedBatches = Math.ceil(FX_PAIRS.length / 20);
    const batchCalls = quote.mock.calls.filter(([symbols]) => Array.isArray(symbols));
    expect(batchCalls).toHaveLength(expectedBatches);
    expect(expectedBatches).toBeLessThan(FX_PAIRS.length);
  });

  it('reuses the cached board until it is forced', async () => {
    const quote = mockProvider();
    const service = new FxService();
    const expectedBatches = Math.ceil(FX_PAIRS.length / 20);

    await service.getBoard();
    await service.getBoard();

    expect(quote.mock.calls.filter(([symbols]) => Array.isArray(symbols))).toHaveLength(expectedBatches);

    await service.getBoard(true);
    expect(quote.mock.calls.filter(([symbols]) => Array.isArray(symbols))).toHaveLength(expectedBatches * 2);
  });

  it('fills the context with the rate book, crosses and dollar index', async () => {
    mockProvider();
    const service = new FxService();

    const context = await service.getContext('EURUSD');

    expect(context).not.toBeNull();
    expect(context?.pair?.code).toBe('EURUSD');
    expect(context?.rates.EURUSD).toBeGreaterThan(0);
    expect(context?.crosses.length).toBeGreaterThan(0);
    expect(context?.crosses.every(row => row.code !== 'EURUSD')).toBe(true);
    expect(context?.dxy).toEqual({ price: 104.25, changePercent: 0.31 });
  });

  it('keeps the rows from healthy batches when one batch fails', async () => {
    let batchIndex = 0;
    vi.spyOn(yahooFinance, 'quote').mockImplementation((async (symbols: unknown) => {
      if (Array.isArray(symbols)) {
        batchIndex++;
        if (batchIndex === 1) throw new Error('batch down');
        return symbols.map((symbol, index) => ({
          symbol,
          regularMarketPrice: 1 + index / 100,
          regularMarketChangePercent: 0.2,
        }));
      }
      return null;
    }) as any);

    const service = new FxService();
    const board = await service.getBoard();
    const expectedBatches = Math.ceil(FX_PAIRS.length / 20);

    // One batch lost, the rest still populate the board.
    expect(board.length).toBeGreaterThan(0);
    expect(board.length).toBeLessThan(FX_PAIRS.length);
    expect(board.length).toBe(FX_PAIRS.length - 20);
    expect(expectedBatches).toBeGreaterThan(1);
  });

  it('returns null context for a non-FX symbol', async () => {
    const service = new FxService();
    await expect(service.getContext('AAPL')).resolves.toBeNull();
  });
});
