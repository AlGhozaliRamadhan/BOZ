export interface MarketData {
  current_price: number;
  change_1h: number;
  change_4h: number | string;
  change_24h: number | string;
  low_24h: number;
  high_24h: number;
  range_24h_pct: number | string;
  volume: number;
  volume_ratio: number;
  volume_classification: string;
  volume_trend: string;
  obv_signal: string;
  obv_trend: string;
  obv_divergence: string;
  rsi: number;
  macd: number;
  macd_signal: number;
  price_vs_sma20: number;
  price_vs_sma50: number | string;
  price_vs_sma200: number | string;
  volatility_1h: number;
  volatility_4h: number;
  volatility_24h: number;
  volatility_regime: string;
  volatility_warning: string;
  atr: number;
  atr_percent: number;
  bb_width: number;
  bb_squeeze_status: string;
  bb_position: string;
  is_incomplete_candle?: boolean;
  using_realtime_price?: boolean;
  realtime_source?: string;
  yahoo_price?: number;
  data_age_minutes?: number;
}

export interface Candle {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  [key: string]: any;
}
