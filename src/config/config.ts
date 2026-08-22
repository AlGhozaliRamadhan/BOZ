import { githubConfig } from './github.config.js';
import { offlineConfig } from './offline.config.js';
import { nvidiaConfig }  from './nvidia.config.js';
import { customConfig }  from './custom.config.js';
import { resolveSymbol } from '../shared/market-constants.js';

export type AIProvider = 'github' | 'offline' | 'nvidia' | 'custom';
export type RiskMode = 'auto' | 'on' | 'off';

const normalizeProvider = (value: string | undefined): AIProvider => {
  const v = (value || '').toLowerCase();
  if (v === 'offline') return 'offline';
  if (v === 'nvidia')  return 'nvidia';
  if (v === 'custom' || v === '9router') return 'custom';
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
  setAIModel(model: string) {
    if (activeState.aiProvider === 'offline') {
      offlineConfig.model = model;
    } else if (activeState.aiProvider === 'nvidia') {
      nvidiaConfig.model = model;
    } else if (activeState.aiProvider === 'custom') {
      customConfig.model = model;
    } else {
      githubConfig.model = model;
    }
    activeState.aiModel = model;
  },
  setRiskMode(mode: RiskMode) {
    activeState.riskMode = mode;
  },
};
