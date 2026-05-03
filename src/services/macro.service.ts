import { YahooService } from './yahoo.service.js';

export class MacroService {
  private yahooService: YahooService;

  constructor() {
    this.yahooService = new YahooService();
  }

  async getMacroContext(): Promise<any> {
    const macroData: any = {
      market_regime: "UNKNOWN",
      sp500_correlation: "N/A",
      nasdaq_correlation: "N/A",
      risk_sentiment: "NEUTRAL",
      tech_sector_performance: {}
    };

    const date = new Date();
    date.setDate(date.getDate() - 5);

    try {
      const spyData = await this.yahooService.getHistoricalData('SPY', date, '1d');
      if (spyData.length >= 2) {
        const first = spyData[0]?.close;
        const last = spyData[spyData.length - 1]?.close;
        if (first && last) {
          const spyChange = ((last - first) / first) * 100;
          
          if (Math.abs(spyChange) > 1) {
            if (spyChange > 0) {
              macroData.sp500_correlation = `SPY up ${spyChange.toFixed(2)}% - Risk-on`;
              macroData.risk_sentiment = "RISK_ON";
            } else {
              macroData.sp500_correlation = `SPY down ${spyChange.toFixed(2)}% - Risk-off`;
              macroData.risk_sentiment = "RISK_OFF";
            }
          } else {
            macroData.sp500_correlation = `SPY flat (${spyChange.toFixed(2)}%)`;
          }
        }
      }
    } catch (err) {}

    try {
      const qqqData = await this.yahooService.getHistoricalData('QQQ', date, '1d');
      if (qqqData.length >= 2) {
        const first = qqqData[0]?.close;
        const last = qqqData[qqqData.length - 1]?.close;
        if (first && last) {
          const qqqChange = ((last - first) / first) * 100;
          macroData.nasdaq_correlation = `QQQ ${qqqChange >= 0 ? 'up' : 'down'} ${qqqChange.toFixed(2)}%`;
        }
      }
    } catch (err) {}

    return macroData;
  }
}
