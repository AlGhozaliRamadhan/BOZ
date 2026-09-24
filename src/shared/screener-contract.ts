import type { Bias, Conviction, PlanAction, PlanStatus } from './dashboard-analysis.js';

export type ScreenerPreset =
  | 'momentum'
  | 'breakout'
  | 'rebound'
  | 'oversold'
  | 'downtrend'
  | 'near_52w_low';

export type ScreenerDirection = 'buy' | 'sell' | 'any';
export type ScreenerMode = 'fast' | 'deep';

export interface ExpertSignalPlan {
  setup: string;
  entryLabel: string;
  entry: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
  invalidation: string;
}

export interface ExpertSignal {
  bias: Bias;
  action: PlanAction;
  conviction: Conviction;
  score: number;
  status: PlanStatus;
  reasons: string[];
  warnings: string[];
  dataQuality: number;
  asOf: string;
  plan: ExpertSignalPlan;
}

export interface ScreenerMetrics {
  price: number;
  chg1d: number;
  chg5d: number;
  chg20d: number;
  volumeRatio: number | null;
  rsi: number | null;
  macdHistogram: number | null;
  from52wHigh: number | null;
  from52wLow: number | null;
  atrPercent: number | null;
}

export interface ScreenerResult {
  ticker: string;
  name: string;
  sector: string;
  metrics: ScreenerMetrics;
  screenScore: number;
  matchedPreset: ScreenerPreset;
  expertSignal: ExpertSignal;
}

export type ScreenerUniverse = 'idx' | 'us' | 'crypto' | 'global';

export interface ScreenerQuery {
  sector: string;
  preset: ScreenerPreset;
  direction: ScreenerDirection;
  mode: ScreenerMode;
  minimumConviction?: Conviction;
  universe?: ScreenerUniverse;
}

export interface ScreenerMeta {
  startedAt: string;
  completedAt: string;
  universeCount: number;
  candidateCount: number;
  enrichedCount: number;
  skippedCount: number;
  partial: boolean;
  cacheHit: boolean;
}

export interface ScreenerSummary {
  bullish: number;
  bearish: number;
  neutral: number;
  buyCount: number;
  sellCount: number;
  watchCount: number;
  avoidCount: number;
  averageScore: number;
  breadthSignal: string;
}

export interface ScreenerResponse {
  schemaVersion: 1;
  timestamp: string;
  query: ScreenerQuery;
  meta: ScreenerMeta;
  summary: ScreenerSummary;
  results: ScreenerResult[];
}
