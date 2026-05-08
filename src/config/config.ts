import { githubConfig } from './github.config.js';
import { offlineConfig } from './offline.config.js';
import { nvidiaConfig }  from './nvidia.config.js';
import { resolveSymbol } from '../shared/market-constants.js';

export type AIProvider = 'github' | 'offline' | 'nvidia';
export type RiskMode = 'auto' | 'on' | 'off';

const normalizeProvider = (value: string | undefined): AIProvider => {
  const v = (value || '').toLowerCase();
  if (v === 'offline') return 'offline';
  if (v === 'nvidia')  return 'nvidia';
  return 'github';
};

const activeState = {
  aiProvider: normalizeProvider(process.env.AI_PROVIDER),
  aiEndpoint: '',
  aiModel:    '',
  ticker:     'NVDA',
  riskMode:   'auto' as RiskMode,
};

const warnIfMisconfigured = (provider: AIProvider) => {
  if (provider === 'github' && !githubConfig.token) {
    console.warn('WARNING: GITHUB_TOKEN not found in environment variables');
  }
  if (provider === 'offline' && !offlineConfig.endpoint) {
    console.warn('WARNING: OFFLINE_AI_URL not found in environment variables');
  }
  if (provider === 'nvidia' && !nvidiaConfig.apiKey) {
    console.warn('WARNING: NVIDIA_API_KEY not found in environment variables');
  }
};

const applyProvider = (provider: AIProvider) => {
  activeState.aiProvider = provider;

  if (provider === 'offline') {
    activeState.aiEndpoint = offlineConfig.endpoint;
    activeState.aiModel    = offlineConfig.model;
  } else if (provider === 'nvidia') {
    activeState.aiEndpoint = nvidiaConfig.baseURL;
    activeState.aiModel    = nvidiaConfig.model;
  } else {
    activeState.aiEndpoint = githubConfig.endpoint;
    activeState.aiModel    = githubConfig.model;
  }

  warnIfMisconfigured(provider);
};

applyProvider(activeState.aiProvider);

export const config = {
  github:  githubConfig,
  offline: offlineConfig,
  nvidia:  nvidiaConfig,

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
  setAIProvider(provider: AIProvider) {
    applyProvider(provider);
  },
  setRiskMode(mode: RiskMode) {
    activeState.riskMode = mode;
  },
};
