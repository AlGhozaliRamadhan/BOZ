export const OPENAI_MODELS: { id: string; label: string }[] = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra (OpenAI flagship)' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol (professional)' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra (balanced)' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna (fast)' },
];

export const openaiConfig = {
  provider: 'openai' as const,
  get apiKey() { return (process.env.OPENAI_API_KEY || '').trim(); },
  endpoint: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.OPENAI_AI_MODEL || OPENAI_MODELS[0].id,
};
