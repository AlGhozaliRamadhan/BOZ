export const offlineConfig = {
  provider: 'offline' as const,
  endpoint: process.env.OFFLINE_AI_URL || '',
  model: process.env.OFFLINE_AI_MODEL || 'qwen3-14b-t4',
};
