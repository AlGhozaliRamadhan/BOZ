import { githubConfig } from './github.config.js';
import { offlineConfig } from './offline.config.js';

export type AIProvider = 'github' | 'offline';

const normalizeProvider = (value: string | undefined): AIProvider =>
  (value || '').toLowerCase() === 'offline' ? 'offline' : 'github';

const activeState = {
  aiProvider: normalizeProvider(process.env.AI_PROVIDER),
  aiEndpoint: '',
  aiModel: '',
};

const warnIfMisconfigured = (provider: AIProvider) => {
  if (provider === 'github' && !githubConfig.token) {
    console.warn("WARNING: GITHUB_TOKEN not found in environment variables");
  }

  if (provider === 'offline' && !offlineConfig.endpoint) {
    console.warn("WARNING: OFFLINE_AI_URL not found in environment variables");
  }
};

const applyProvider = (provider: AIProvider) => {
  activeState.aiProvider = provider;
  activeState.aiEndpoint = provider === 'offline' ? offlineConfig.endpoint : githubConfig.endpoint;
  activeState.aiModel = provider === 'offline' ? offlineConfig.model : githubConfig.model;
  warnIfMisconfigured(provider);
};

applyProvider(activeState.aiProvider);

export const config = {
  ticker: 'NVDA',
  github: githubConfig,
  offline: offlineConfig,
  get aiProvider() {
    return activeState.aiProvider;
  },
  get aiEndpoint() {
    return activeState.aiEndpoint;
  },
  get aiModel() {
    return activeState.aiModel;
  },
  setOfflineEndpoint(endpoint: string) {
    offlineConfig.endpoint = endpoint;
    if (activeState.aiProvider === 'offline') {
      applyProvider('offline');
    }
  },
  setAIProvider(provider: AIProvider) {
    applyProvider(provider);
  },
};
