export const githubConfig = {
  provider: 'github' as const,
  get token() { return process.env.GITHUB_TOKEN || ''; }, // lazy: read after dotenv.config()
  endpoint: process.env.GITHUB_AI_ENDPOINT || 'https://models.github.ai/inference',
  model: process.env.GITHUB_AI_MODEL || 'openai/gpt-4o-mini',
};
