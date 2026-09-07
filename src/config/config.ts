import { githubConfig } from './github.config.js';
import { offlineConfig } from './offline.config.js';
import { nvidiaConfig }  from './nvidia.config.js';
import { customConfig }  from './custom.config.js';
import { openaiConfig } from './openai.config.js';
import { anthropicConfig } from './anthropic.config.js';
import { groqConfig } from './groq.config.js';
import { openrouterConfig } from './openrouter.config.js';
import { resolveSymbol } from '../shared/market-constants.js';

export type AIProvider =
  | 'github'
  | 'offline'
  | 'nvidia'
  | 'custom'
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'openrouter';
export type RiskMode = 'auto' | 'on' | 'off';

const normalizeProvider = (value: string | undefined): AIProvider => {
  const v = (value || '').toLowerCase();
  if (v === 'offline') return 'offline';
  if (v === 'nvidia')  return 'nvidia';
  if (v === 'custom' || v === '9router') return 'custom';
  if (v === 'openai') return 'openai';
  if (v === 'anthropic') return 'anthropic';
  if (v === 'groq') return 'groq';
  if (v === 'openrouter') return 'openrouter';
  return 'github';
};

const activeState = {
  aiProvider: normalizeProvider(process.env.AI_PROVIDER),
  aiEndpoint: '',
  aiModel:    '',
  ticker:     'NVDA',
  riskMode:   'auto' as RiskMode,
};

const applyProvider = (provider: AIProvider) => {
  activeState.aiProvider = provider;

  if (provider === 'offline') {
    activeState.aiEndpoint = offlineConfig.endpoint;
    activeState.aiModel    = offlineConfig.model;
  } else if (provider === 'nvidia') {
    activeState.aiEndpoint = nvidiaConfig.baseURL;
    activeState.aiModel    = nvidiaConfig.model;
  } else if (provider === 'custom') {
    activeState.aiEndpoint = customConfig.endpoint;
    activeState.aiModel    = customConfig.model;
  } else if (provider === 'openai') {
    activeState.aiEndpoint = openaiConfig.endpoint;
    activeState.aiModel    = openaiConfig.model;
  } else if (provider === 'anthropic') {
    activeState.aiEndpoint = anthropicConfig.endpoint;
    activeState.aiModel    = anthropicConfig.model;
  } else if (provider === 'groq') {
    activeState.aiEndpoint = groqConfig.endpoint;
    activeState.aiModel    = groqConfig.model;
  } else if (provider === 'openrouter') {
    activeState.aiEndpoint = openrouterConfig.endpoint;
    activeState.aiModel    = openrouterConfig.model;
  } else {
    activeState.aiEndpoint = githubConfig.endpoint;
    activeState.aiModel    = githubConfig.model;
  }
};

applyProvider(activeState.aiProvider);

export const config = {
  github:  githubConfig,
  offline: offlineConfig,
  nvidia:  nvidiaConfig,
  custom:  customConfig,
  openai: openaiConfig,
  anthropic: anthropicConfig,
  groq: groqConfig,
  openrouter: openrouterConfig,

  get ticker() { return activeState.ticker; },
  get aiProvider() { return activeState.aiProvider; },
  get aiEndpoint() { return activeState.aiEndpoint; },
  get aiModel()    { return activeState.aiModel;    },
  get riskMode()   { return activeState.riskMode;   },

  setTicker(raw: string) {
    const resolved = resolveSymbol(raw);
    if (!resolved) throw new Error(`Unknown ticker: ${raw}`);
    activeState.ticker = resolved;
  },

  setOfflineEndpoint(endpoint: string) {
    offlineConfig.endpoint = endpoint;
    if (activeState.aiProvider === 'offline') applyProvider('offline');
  },
  setCustomEndpoint(endpoint: string) {
    customConfig.endpoint = endpoint.replace(/\/+$/, '');
    if (activeState.aiProvider === 'custom') applyProvider('custom');
  },
  setAIProvider(provider: AIProvider) {
    applyProvider(provider);
  },
  setAIModel(model: string, provider: AIProvider = activeState.aiProvider) {
    if (provider === 'offline') {
      offlineConfig.model = model;
    } else if (provider === 'nvidia') {
      nvidiaConfig.model = model;
    } else if (provider === 'custom') {
      customConfig.model = model;
    } else if (provider === 'openai') {
      openaiConfig.model = model;
    } else if (provider === 'anthropic') {
      anthropicConfig.model = model;
    } else if (provider === 'groq') {
      groqConfig.model = model;
    } else if (provider === 'openrouter') {
      openrouterConfig.model = model;
    } else {
      githubConfig.model = model;
    }
    if (activeState.aiProvider === provider) activeState.aiModel = model;
  },
  setRiskMode(mode: RiskMode) {
    activeState.riskMode = mode;
  },
};
