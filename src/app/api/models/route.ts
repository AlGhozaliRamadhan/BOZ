import { errorResponse, jsonResponse } from '@/app/lib/api-helpers';
import { config, type AIProvider } from '@/config/config';
import { GITHUB_MODELS } from '@/config/github.config';
import { NVIDIA_MODELS } from '@/config/nvidia.config';
import { OPENAI_MODELS } from '@/config/openai.config';
import { ANTHROPIC_MODELS } from '@/config/anthropic.config';
import { GROQ_MODELS } from '@/config/groq.config';
import { OPENROUTER_MODELS } from '@/config/openrouter.config';
import { parseCustomModels } from '@/config/custom.config';
import { getProviderModelsCached } from '@/services/ai/provider-models.client';
import { log } from '@/utils/logger';

const PROVIDERS: AIProvider[] = [
  'github', 'offline', 'nvidia', 'custom', 'openai', 'anthropic', 'groq', 'openrouter',
];

function persistedCustomModels() {
  const list = parseCustomModels(process.env.CUSTOM_AI_MODELS);
  const current = config.custom.model;
  if (current && !list.some((model) => model.id === current)) {
    list.unshift({ id: current, label: current });
  }
  return list;
}

// Same per-provider view the settings payload serves; the live listing
// replaces this when the catalog fetch succeeds.
function curatedModels(provider: AIProvider): { id: string; label: string }[] {
  switch (provider) {
    case 'github': return GITHUB_MODELS;
    case 'nvidia': return NVIDIA_MODELS;
    case 'openai': return OPENAI_MODELS;
    case 'anthropic': return ANTHROPIC_MODELS;
    case 'groq': return GROQ_MODELS;
    case 'openrouter': return OPENROUTER_MODELS;
    case 'custom': return persistedCustomModels();
    case 'offline': return [{ id: config.offline.model, label: config.offline.model }];
  }
}

function currentModelFor(provider: AIProvider): string {
  switch (provider) {
    case 'custom': return config.custom.model;
    case 'offline': return config.offline.model;
    case 'nvidia': return config.nvidia.model;
    case 'openai': return config.openai.model;
    case 'anthropic': return config.anthropic.model;
    case 'groq': return config.groq.model;
    case 'openrouter': return config.openrouter.model;
    case 'github': return config.github.model;
  }
}

// The active model may not exist in the live catalog (custom ID, renamed
// upstream, new model). Keep it first so the picker can always show what's
// actually in use.
function withCurrentModel(
  models: { id: string; label: string }[],
  current: string,
): { id: string; label: string }[] {
  if (!current || models.some((model) => model.id === current)) return models;
  return [{ id: current, label: current }, ...models];
}

export async function GET(request: Request) {
  const providerParam = new URL(request.url).searchParams.get('provider') || '';
  if (!PROVIDERS.includes(providerParam as AIProvider)) {
    return errorResponse('Unknown provider', 400);
  }
  const provider = providerParam as AIProvider;
  const current = currentModelFor(provider);

  try {
    const live = await getProviderModelsCached(provider);
    const models = withCurrentModel(live ? live.models : curatedModels(provider), current);
    return jsonResponse({ provider, models, source: live ? 'live' : 'persisted' });
  } catch (error) {
    log.error('models', error instanceof Error ? error.message : 'Unknown models listing error');
    return errorResponse('Unable to list models', 500);
  }
}
