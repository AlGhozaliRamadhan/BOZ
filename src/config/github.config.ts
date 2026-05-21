// Shared token-creation URL — imported by cli.ts and ai.service.ts to avoid duplication
export const GITHUB_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new' +
  '?description=Used+to+call+GitHub+Models+APIs+to+easily+run+LLMs%3A+' +
  'https%3A%2F%2Fdocs.github.com%2Fgithub-models%2Fquickstart%23step-2-make-an-api-call' +
  '&name=GitHub+Models+token&user_models=read';

export const githubConfig = {
  provider: 'github' as const,
  get token() { return (process.env.GITHUB_TOKEN || '').trim(); }, // lazy: read after dotenv.config()
  endpoint: process.env.GITHUB_AI_ENDPOINT || 'https://models.github.ai/inference',
  model: process.env.GITHUB_AI_MODEL || 'openai/gpt-4o',
};
