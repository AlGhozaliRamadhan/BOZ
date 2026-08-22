import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });

export const aiPredictionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['ok', 'uncertain', 'error'] },
    prediction: { type: 'string', enum: ['UP', 'DOWN', 'UNKNOWN'] },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    strategy: { type: ['string', 'null'] },
    thesis: { type: ['string', 'null'] },
    target_price: { type: ['number', 'null'] },
    stop_loss: { type: ['number', 'null'] },
    reasons: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  oneOf: [
    {
      properties: { status: { const: 'ok' } },
      required: ['status', 'prediction', 'confidence'],
    },
    {
      properties: { status: { enum: ['error', 'uncertain'] } },
      required: ['status', 'reason'],
    },
  ],
} as const;

const eventSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['event', 'affected_assets', 'direction', 'impact_level', 'time_horizon', 'reasoning'],
  properties: {
    event: { type: 'string' },
    affected_assets: { type: 'array', items: { type: 'string' } },
    direction: { type: 'string', enum: ['BULL', 'BEAR', 'NEUTRAL'] },
    impact_level: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    time_horizon: { type: 'string', enum: ['IMMEDIATE', 'SHORT_TERM', 'MEDIUM_TERM', 'LONG_TERM'] },
    reasoning: { type: 'string' },
    second_order: { type: 'string' },
  },
} as const;

const opportunitySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'asset',
    'asset_type',
    'action',
    'confidence',
    'reasoning',
    'entry_range',
    'target_range',
    'stop_loss',
    'late_signal',
    'invalidation',
    'risks',
  ],
  properties: {
    asset: { type: 'string' },
    asset_type: { type: 'string', enum: ['crypto', 'stock', 'commodity', 'forex', 'index'] },
    action: { type: 'string', enum: ['BUY', 'SELL', 'WATCH'] },
    confidence: { type: 'number', minimum: 0, maximum: 100 },
    reasoning: { type: 'string' },
    entry_range: { type: 'string' },
    target_range: { type: 'string' },
    stop_loss: { type: 'string' },
    late_signal: { type: 'string' },
    invalidation: { type: 'string' },
    risks: { type: 'string' },
    spot_price: { type: ['number', 'null'] },
  },
} as const;

export const newsIntelSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'market_regime',
    'market_summary',
    'overall_market_sentiment',
    'cross_asset_themes',
    'high_impact_events',
    'opportunities',
    'contrarian_signals',
    'risk_warnings',
    'recommended_actions',
  ],
  properties: {
    market_regime: { type: 'string', enum: ['RISK_ON', 'RISK_OFF', 'TRANSITION'] },
    market_summary: { type: 'string' },
    overall_market_sentiment: { type: 'string', enum: ['RISK_ON', 'RISK_OFF', 'NEUTRAL'] },
    cross_asset_themes: { type: 'array', items: { type: 'string' } },
    high_impact_events: { type: 'array', items: eventSchema },
    opportunities: { type: 'array', items: opportunitySchema },
    contrarian_signals: { type: 'array', items: { type: 'string' } },
    risk_warnings: { type: 'array', items: { type: 'string' } },
    recommended_actions: { type: 'array', items: { type: 'string' } },
  },
} as const;

export const validateAiPrediction = ajv.compile(aiPredictionSchema) as ValidateFunction;
export const validateNewsIntel = ajv.compile(newsIntelSchema) as ValidateFunction;

export function formatSchemaErrors(errors?: ErrorObject[] | null): string[] {
  if (!errors || errors.length === 0) return [];
  return errors.map((err) => {
    const path = err.instancePath && err.instancePath.length > 0 ? err.instancePath : '$';
    return `${path} ${err.message ?? 'invalid'}`.trim();
  });
}
