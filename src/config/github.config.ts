// Shared token-creation URL — imported by cli.ts and ai.service.ts to avoid duplication
export const GITHUB_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new' +
  '?description=Used+to+call+GitHub+Models+APIs+to+easily+run+LLMs%3A+' +
  'https%3A%2F%2Fdocs.github.com%2Fgithub-models%2Fquickstart%23step-2-make-an-api-call' +
  '&name=GitHub+Models+token&user_models=read';

export const GITHUB_MODELS: { id: string; label: string }[] = [
  { id: 'openai/gpt-4o',                      label: 'GPT-4o              (OpenAI, recommended)' },
  { id: 'openai/gpt-4o-mini',                 label: 'GPT-4o mini         (OpenAI, fast & generous quota)' },
  { id: 'openai/gpt-5',                        label: 'GPT-5               (OpenAI, most capable)' },
  { id: 'deepseek/DeepSeek-R1-0528',           label: 'DeepSeek R1-0528    (reasoning model)' },
  { id: 'deepseek/DeepSeek-V3-0324',           label: 'DeepSeek V3-0324    (fast, balanced)' },
  { id: 'meta/Llama-4-Scout-17B-16E-Instruct', label: 'Llama 4 Scout 17B  (Meta, free tier)' },
  { id: 'microsoft/Phi-4',                     label: 'Phi-4               (Microsoft, lightweight)' },
];

export const githubConfig = {
  provider: 'github' as const,
  get token() { return (process.env.GITHUB_TOKEN || '').trim(); }, // lazy: read after dotenv.config()
  endpoint: process.env.GITHUB_AI_ENDPOINT || 'https://models.github.ai/inference',
  model: process.env.GITHUB_AI_MODEL || GITHUB_MODELS[0].id,
};
