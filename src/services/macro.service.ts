import { YahooService } from './yahoo.service.js';
import { MacroContext } from '../types/types.js';
import { log } from '../utils/logger.js';
import { config } from '../config/config.js';

function standardizeTnxYield(val: number): number {
  if (val < 0.2) return val * 100; // decimal format (e.g. 0.0425 -> 4.25%)
  if (val > 10.0) return val / 10; // scaled-by-10 format (e.g. 42.5 -> 4.25%)
  return val;                     // percentage format (e.g. 4.25 -> 4.25%)
}

export class MacroService {
  private yahooService: YahooService;

  constructor() {
    this.yahooService = new YahooService();
  }

  async getMacroContext(): Promise<MacroContext> {
    const macroData: MacroContext = {
      market_regime:           'UNKNOWN',
      sp500_correlation:       'N/A',
      nasdaq_correlation:      'N/A',
      risk_sentiment:          'NEUTRAL',
      tech_sector_performance: {},
      sp500_corr:              null,
      sp500_beta:              null,
      nasdaq_corr:             null,
      nasdaq_beta:             null,
      vix_level:               null,
      tnx_yield:               null,
    };

    const date = new Date();
    date.setDate(date.getDate() - 120);

    const dateKey = (d: Date): string => d.toISOString().slice(0, 10);

    const buildReturnMap = (candles: { date: Date; close: number }[]): Map<string, number> => {
      const map = new Map<string, number>();
      for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1].close;
        const curr = candles[i].close;
        if (prev > 0) {
          map.set(dateKey(candles[i].date), (curr - prev) / prev);
        }
      }
      return map;
    };

    const alignReturns = (a: Map<string, number>, b: Map<string, number>, limit = 60): [number[], number[]] => {
      const dates = Array.from(a.keys()).filter((k) => b.has(k)).sort();
      const selected = dates.slice(-limit);
      return [selected.map((d) => a.get(d) as number), selected.map((d) => b.get(d) as number)];
    };

    const pearson = (x: number[], y: number[]): number | null => {
      if (x.length < 20 || y.length < 20) return null;
      const n = Math.min(x.length, y.length);
      const mx = x.reduce((a, b) => a + b, 0) / n;
      const my = y.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let dx = 0;
      let dy = 0;
      for (let i = 0; i < n; i++) {
        const vx = x[i] - mx;
        const vy = y[i] - my;
        num += vx * vy;
        dx += vx * vx;
        dy += vy * vy;
      }
      if (dx === 0 || dy === 0) return null;
      return num / Math.sqrt(dx * dy);
    };

    const beta = (asset: number[], bench: number[]): number | null => {
      if (asset.length < 20 || bench.length < 20) return null;
      const n = Math.min(asset.length, bench.length);
      const ma = asset.reduce((a, b) => a + b, 0) / n;
      const mb = bench.reduce((a, b) => a + b, 0) / n;
      let cov = 0;
      let varB = 0;
      for (let i = 0; i < n; i++) {
        const va = asset[i] - ma;
        const vb = bench[i] - mb;
        cov += va * vb;
        varB += vb * vb;
      }
      if (varB === 0) return null;
      return cov / varB;
    };

    const nDayReturn = (candles: { close: number }[], days: number): number | null => {
      if (candles.length <= days) return null;
      const last = candles[candles.length - 1].close;
      const prev = candles[candles.length - 1 - days].close;
      return prev > 0 ? ((last - prev) / prev) * 100 : null;
    };

    if (config.riskMode === 'on') {
      macroData.risk_sentiment = 'RISK_ON';
      macroData.sp500_correlation = 'Manual Override - Risk-on';
    } else if (config.riskMode === 'off') {
      macroData.risk_sentiment = 'RISK_OFF';
      macroData.sp500_correlation = 'Manual Override - Risk-off';
    } else {
      try {
        const [assetData, spyData, qqqData, vixData, tnxData, xlkData] = await Promise.all([
          this.yahooService.getHistoricalData(config.ticker, date, '1d', false, { adjustPrices: true }),
          this.yahooService.getHistoricalData('SPY', date, '1d', false, { adjustPrices: true }),
          this.yahooService.getHistoricalData('QQQ', date, '1d', false, { adjustPrices: true }),
          this.yahooService.getHistoricalData('^VIX', date, '1d', false),
          this.yahooService.getHistoricalData('^TNX', date, '1d', false),
          this.yahooService.getHistoricalData('XLK', date, '1d', false, { adjustPrices: true }),
        ]);

        const spy20d = nDayReturn(spyData, 20);
        if (spy20d !== null) {
          if (spy20d > 1.5) macroData.risk_sentiment = 'RISK_ON';
          else if (spy20d < -1.5) macroData.risk_sentiment = 'RISK_OFF';
        }

        // Determine market regime based on SPY's relation to its SMA-50 and 20-day return momentum
        let spySma50 = null;
        if (spyData.length >= 50) {
          const last50 = spyData.slice(-50);
          spySma50 = last50.reduce((sum, c) => sum + c.close, 0) / 50;
        }

        if (spyData.length > 0 && spySma50 !== null && spy20d !== null) {
          const spyLastPrice = spyData[spyData.length - 1].close;
          const isAboveSma50 = spyLastPrice > spySma50;
          const isPositiveMomentum = spy20d > 0;

          if (isAboveSma50 && isPositiveMomentum) {
            macroData.market_regime = 'BULL_CONFIRMED';
          } else if (isAboveSma50 && !isPositiveMomentum) {
            macroData.market_regime = 'BULL_CORRECTION';
          } else if (!isAboveSma50 && !isPositiveMomentum) {
            macroData.market_regime = 'BEAR_CONFIRMED';
          } else if (!isAboveSma50 && isPositiveMomentum) {
            macroData.market_regime = 'BEAR_RECOVERY';
          }
        }

        // Populate tech sector (XLK) performance and relative strength
        const xlk1d = nDayReturn(xlkData, 1);
        const xlk5d = nDayReturn(xlkData, 5);
        const xlk20d = nDayReturn(xlkData, 20);
        const relativeStrength = (xlk20d !== null && spy20d !== null) ? xlk20d - spy20d : null;

        macroData.tech_sector_performance = {
          xlk_1d_performance: xlk1d,
          xlk_5d_performance: xlk5d,
          xlk_20d_performance: xlk20d,
          relative_strength_vs_spy: relativeStrength,
        };

        const assetReturns = buildReturnMap(assetData);
        const spyReturns   = buildReturnMap(spyData);
        const qqqReturns   = buildReturnMap(qqqData);

        if (config.ticker === 'SPY') {
          macroData.sp500_corr = 1;
          macroData.sp500_beta = 1;
          macroData.sp500_correlation = 'SELF (corr 1.00, beta 1.00)';
        } else {
          const [assetVsSpy, spyVsAsset] = alignReturns(assetReturns, spyReturns, 60);
          const corr = pearson(assetVsSpy, spyVsAsset);
          const b = beta(assetVsSpy, spyVsAsset);
          macroData.sp500_corr = corr;
          macroData.sp500_beta = b;
          if (corr !== null && b !== null) {
            macroData.sp500_correlation = `Corr ${corr.toFixed(2)} · Beta ${b.toFixed(2)} (60d)`;
          }
        }

        if (config.ticker === 'QQQ') {
          macroData.nasdaq_corr = 1;
          macroData.nasdaq_beta = 1;
          macroData.nasdaq_correlation = 'SELF (corr 1.00, beta 1.00)';
        } else {
          const [assetVsQqq, qqqVsAsset] = alignReturns(assetReturns, qqqReturns, 60);
          const corr = pearson(assetVsQqq, qqqVsAsset);
          const b = beta(assetVsQqq, qqqVsAsset);
          macroData.nasdaq_corr = corr;
          macroData.nasdaq_beta = b;
          if (corr !== null && b !== null) {
            macroData.nasdaq_correlation = `Corr ${corr.toFixed(2)} · Beta ${b.toFixed(2)} (60d)`;
          }
        }

        const vixLast = vixData[vixData.length - 1]?.close;
        if (typeof vixLast === 'number') macroData.vix_level = vixLast;

        const tnxLast = tnxData[tnxData.length - 1]?.close;
        if (typeof tnxLast === 'number') {
          macroData.tnx_yield = standardizeTnxYield(tnxLast);
        }
      } catch (err) {
        log.warn('macro', `Macro fetch failed: ${(err as Error).message}`);
      }
    }

    return macroData;
  }
}
