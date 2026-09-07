export const OPENROUTER_MODELS: { id: string; label: string }[] = [
  { id: '~openai/gpt-latest', label: 'OpenAI GPT Latest (OpenRouter)' },
  { id: 'openai/gpt-6-astra', label: 'GPT-6 Astra (OpenRouter)' },
  { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5 (OpenRouter)' },
  { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (OpenRouter)' },
];

export const openrouterConfig = {
  provider: 'openrouter' as const,
  get apiKey() { return (process.env.OPENROUTER_API_KEY || '').trim(); },
  endpoint: 'https://openrouter.ai/api/v1',
  model: process.env.OPENROUTER_AI_MODEL || OPENROUTER_MODELS[0].id,
};
