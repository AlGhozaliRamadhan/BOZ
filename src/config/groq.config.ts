export const GROQ_MODELS: { id: string; label: string }[] = [
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (Groq)' },
  { id: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B (Groq)' },
  { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Groq)' },
];

export const groqConfig = {
  provider: 'groq' as const,
  get apiKey() { return (process.env.GROQ_API_KEY || '').trim(); },
  endpoint: 'https://api.groq.com/openai/v1',
  model: process.env.GROQ_AI_MODEL || GROQ_MODELS[0].id,
};
