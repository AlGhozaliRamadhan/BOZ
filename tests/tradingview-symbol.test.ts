import { describe, expect, it } from 'vitest';
import { toTradingViewSymbol } from '../src/app/lib/tradingview-symbol';

describe('toTradingViewSymbol', () => {
  it.each([
    ['BTC-USD', 'BINANCE:BTCUSDT'],
    ['BBCA.JK', 'IDX:BBCA'],
    ['^GSPC', 'SP:SPX'],
    ['BRK.B', 'NYSE:BRK.B'],
    ['NASDAQ:MSFT', 'NASDAQ:MSFT'],
  ])('maps %s to %s', (input, expected) => {
    expect(toTradingViewSymbol(input)).toBe(expected);
  });

  it.each([
    'NASDAQ:<img src=x onerror=alert(1)>',
    'NASDAQ:AAPL\"><svg/onload=alert(1)>',
    'NASDAQ:AAPL:EXTRA',
    'AAPL/../../secrets',
  ])('rejects markup or path-bearing symbols', (input) => {
    expect(toTradingViewSymbol(input)).toBe('NASDAQ:AAPL');
  });
});
