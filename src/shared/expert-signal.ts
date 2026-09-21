import type { DashboardAnalysis, PlanStatus } from './dashboard-analysis.js';
import type { ExpertSignal } from './screener-contract.js';

const MIN_ACTIVE_SIGNAL_QUALITY = 60;
const MIN_ACTIVE_VOLUME_RATIO = 1;

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export function calculateExpertSignalDataQuality(analysis: DashboardAnalysis): number {
  const structure = analysis.structure;
  const checks = [
    hasValue(structure.sma20),
    hasValue(structure.sma50),
    hasValue(structure.sma200),
    hasValue(structure.rsi),
    hasValue(structure.macd),
    hasValue(structure.atr),
    hasValue(structure.volumeRatio),
    hasValue(structure.obvTrend),
    hasValue(structure.high52w) && hasValue(structure.low52w),
  ];
  const available = checks.filter(Boolean).length;
  return Math.round((available / checks.length) * 100);
}

function buildWarnings(analysis: DashboardAnalysis, dataQuality: number, criticalDataAvailable: boolean): string[] {
  const warnings: string[] = [];
  const structure = analysis.structure;

  if (dataQuality < MIN_ACTIVE_SIGNAL_QUALITY) {
    warnings.push('Insufficient technical history for an active signal.');
  }
  if (!criticalDataAvailable && dataQuality >= MIN_ACTIVE_SIGNAL_QUALITY) {
    warnings.push('A required trend, momentum, volatility, or volume indicator is unavailable.');
  }
  if (structure.sma200 == null) {
    warnings.push('Long-term trend is incomplete because SMA-200 is unavailable.');
  }
  if (structure.volumeRatio == null || structure.volumeRatio < MIN_ACTIVE_VOLUME_RATIO) {
    warnings.push('Participation is light or unavailable; wait for volume confirmation.');
  }
  if (analysis.plan.extended) {
    warnings.push('Price is extended; wait for a pullback or retest instead of chasing.');
  }
  if (analysis.plan.riskReward != null && analysis.plan.riskReward < 1.15) {
    warnings.push(`Reward/risk is only ${analysis.plan.riskReward.toFixed(2)}R to the first target.`);
  }
  if (analysis.bias === 'NEUTRAL') {
    warnings.push('Directional evidence conflicts; there is no clear edge.');
  }

  return [...new Set(warnings)].slice(0, 4);
}

function buildReasons(analysis: DashboardAnalysis): string[] {
  const aligned = analysis.signals
    .filter(signal => analysis.bias === 'NEUTRAL' || signal.bias === analysis.bias)
    .sort((a, b) => b.weight - a.weight)
    .map(signal => `${signal.label}: ${signal.detail}`);

  if (aligned.length > 0) return aligned.slice(0, 4);
  return analysis.signals
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map(signal => `${signal.label}: ${signal.detail}`)
    .slice(0, 4);
}

export function buildExpertSignal(analysis: DashboardAnalysis, asOf: string): ExpertSignal {
  const dataQuality = calculateExpertSignalDataQuality(analysis);
  const structure = analysis.structure;
  const criticalDataAvailable = [
    structure.sma50,
    structure.sma200,
    structure.rsi,
    structure.macd,
    structure.atr,
    structure.volumeRatio,
  ].every(hasValue);
  const activeSetup =
    dataQuality >= MIN_ACTIVE_SIGNAL_QUALITY &&
    criticalDataAvailable &&
    structure.volumeRatio != null &&
    structure.volumeRatio >= MIN_ACTIVE_VOLUME_RATIO &&
    analysis.plan.status === 'SETUP';
  const action = activeSetup ? analysis.plan.action : 'WATCH';
  const status: PlanStatus = dataQuality < 45
    ? 'NO_TRADE'
    : activeSetup
      ? 'SETUP'
      : 'WATCH';
  const invalidation = analysis.plan.stop != null
    ? `A decisive move through ${analysis.plan.stop.toLocaleString()} invalidates the setup.`
    : analysis.plan.notes;

  return {
    bias: analysis.bias,
    action,
    conviction: analysis.conviction,
    score: analysis.score,
    status,
    reasons: buildReasons(analysis),
    warnings: buildWarnings(analysis, dataQuality, criticalDataAvailable),
    dataQuality,
    asOf,
    plan: {
      setup: analysis.plan.setup,
      entryLabel: analysis.plan.entryLabel,
      entry: analysis.plan.entry,
      stop: analysis.plan.stop,
      target1: analysis.plan.target1,
      target2: analysis.plan.target2,
      riskReward: analysis.plan.riskReward,
      invalidation,
    },
  };
}
