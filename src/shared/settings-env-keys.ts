// The per-user settings allow-list, in a module with NO node builtins and NO
// package imports. It is reachable from the instrumentation graph, which
// webpack compiles for more than one runtime; a stray `node:fs` import there
// fails the build with "Module not found: Can't resolve 'path'".
export const SETTINGS_ENV_KEYS = [
  'AI_PROVIDER',
  'GITHUB_AI_MODEL',
  'GITHUB_TOKEN',
  'NVIDIA_AI_MODEL',
  'NVIDIA_API_KEY',
  'OFFLINE_AI_URL',
  'OFFLINE_AI_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_AI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AI_MODEL',
  'GROQ_API_KEY',
  'GROQ_AI_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_AI_MODEL',
  'CUSTOM_AI_URL',
  'CUSTOM_AI_KEY',
  'CUSTOM_AI_MODEL',
  'CUSTOM_AI_MODELS',
] as const;

export type SettingsEnvKey = typeof SETTINGS_ENV_KEYS[number];
