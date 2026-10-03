export const OPENROUTER_MODELS: { id: string; label: string }[] = [
  { id: 'openai/gpt-oss-120b:free', label: 'GPT-OSS 120B Free (OpenRouter)' },
  { id: 'openai/gpt-oss-20b:free', label: 'GPT-OSS 20B Free (OpenRouter)' },
  { id: 'openai/gpt-5-mini', label: 'GPT-5 Mini (OpenRouter)' },
  { id: 'anthropic/claude-haiku-4-5', label: 'Claude Haiku 4.5 (OpenRouter)' },
];

export const openrouterConfig = {
  provider: 'openrouter' as const,
  get apiKey() { return (process.env.OPENROUTER_API_KEY || '').trim(); },
  endpoint: 'https://openrouter.ai/api/v1',
  model: process.env.OPENROUTER_AI_MODEL || OPENROUTER_MODELS[0].id,
};
