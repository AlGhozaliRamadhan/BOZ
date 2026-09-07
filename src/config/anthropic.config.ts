export const ANTHROPIC_MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 (most capable)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (balanced)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
];

export const anthropicConfig = {
  provider: 'anthropic' as const,
  get apiKey() { return (process.env.ANTHROPIC_API_KEY || '').trim(); },
  endpoint: 'https://api.anthropic.com/v1',
  model: process.env.ANTHROPIC_AI_MODEL || ANTHROPIC_MODELS[0].id,
};
