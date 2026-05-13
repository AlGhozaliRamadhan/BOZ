export interface MarketData {
  current_price:          number;
  change_1h:              number;
  change_4h:              number;
  change_24h:             number;
  low_24h:                number;
  high_24h:               number;
  range_24h_pct:          number;
  volume:                 number;
  volume_ratio:           number;
  volume_classification:  string;
  volume_trend:           string;
  obv_signal:             string;
  obv_trend:              string;
  obv_divergence:         string;
  rsi:                    number;
  macd:                   number;
  macd_signal:            number;
  price_vs_sma20:         number;
  price_vs_sma50:         number | null;
  price_vs_sma200:        number | null;
  volatility_1h:          number;
  volatility_4h:          number;
  volatility_24h:         number;
  volatility_regime:      string;
  volatility_warning:     string;
  atr:                    number;
  atr_percent:            number;
  bb_width:               number;
  bb_squeeze_status:      string;
  bb_position:            string;
  is_incomplete_candle?:  boolean;
  using_realtime_price?:  boolean;
  realtime_source?:       string;
  yahoo_price?:           number;
  data_age_minutes?:      number;
}

export interface MacroContext {
  market_regime:           string;
  sp500_correlation:       string;
  nasdaq_correlation:      string;
  risk_sentiment:          string;
  tech_sector_performance: Record<string, unknown>;
  sp500_corr?:             number | null;
  sp500_beta?:             number | null;
  nasdaq_corr?:            number | null;
  nasdaq_beta?:            number | null;
  vix_level?:              number | null;
  tnx_yield?:              number | null;
}

export interface Candle {
  date:   Date;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
  // ── Computed by IndicatorsService ─────────────────────────────────────────
  SMA_20?:       number | null;
  SMA_50?:       number | null;
  SMA_200?:      number | null;
  RSI?:          number | null;
  MACD?:         number | null;
  MACD_Signal?:  number | null;
  MACD_Hist?:    number | null;
  BB_High?:      number;
  BB_Low?:       number;
  BB_Mid?:       number;
  BB_Width?:     number;
  ATR?:          number;
  ATR_Percent?:  number;
  OBV?:          number;
  OBV_SMA?:      number;
  OBV_Trend?:    boolean;
  Volume_SMA?:   number;
  Volume_Ratio?: number;
}
