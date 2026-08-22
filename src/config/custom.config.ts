// OpenAI-compatible custom provider (9router and similar local routers).
// Default points at the user's 9router: http://localhost:20128/v1

function parseModelList(raw?: string): { id: string; label: string }[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id, label: id }));
}

function normalizeEndpoint(raw?: string): string {
  const fallback = 'http://localhost:20128/v1';
  const value = (raw || fallback).trim();
  return value.replace(/\/+$/, '');
}

export const CUSTOM_DEFAULT_URL = 'http://localhost:20128/v1';

export const customConfig = {
  provider: 'custom' as const,
  get apiKey() {
    return (process.env.CUSTOM_AI_KEY || '').trim();
  },
  endpoint: normalizeEndpoint(process.env.CUSTOM_AI_URL),
  model: process.env.CUSTOM_AI_MODEL || '',
  models: parseModelList(process.env.CUSTOM_AI_MODELS),
};

export function parseCustomModels(raw?: string): { id: string; label: string }[] {
  return parseModelList(raw);
}

export function normalizeCustomEndpoint(raw?: string): string {
  return normalizeEndpoint(raw);
}
