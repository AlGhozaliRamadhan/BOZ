import { NextRequest } from 'next/server';
import {
  InvalidJsonBodyError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  jsonResponse,
  errorResponse,
  parseBody,
} from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import type { AIProvider, RiskMode } from '@/config/config';
import { GITHUB_MODELS } from '@/config/github.config';
import { NVIDIA_MODELS } from '@/config/nvidia.config';
import { parseCustomModels } from '@/config/custom.config';
import {
  settingsRepository,
  SettingsValidationError,
  type SettingsEnvKey,
  type SettingsEnvUpdates,
} from '@/services/settings/env-settings.repository';
import {
  UnsafeOutboundUrlError,
  validateCustomProviderEndpoint,
} from '@/services/security/outbound-url-policy';
import { resolveSymbol } from '@/shared/market-constants';
import { log } from '@/utils/logger';

const PROVIDERS: AIProvider[] = ['github', 'offline', 'nvidia', 'custom'];
const RISK_MODES: RiskMode[] = ['auto', 'on', 'off'];
const ALLOWED_UPDATE_FIELDS = new Set([
  'provider',
  'model',
  'ticker',
  'riskMode',
  'nvidiaKey',
  'githubToken',
  'customKey',
  'customUrl',
  'customModels',
]);

interface SettingsUpdate {
  provider?: AIProvider;
  model?: string;
  ticker?: string;
  riskMode?: RiskMode;
  nvidiaKey?: string;
  githubToken?: string;
  customKey?: string;
  customUrl?: string;
  customModels?: string[];
}

class SettingsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsInputError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(
  input: Record<string, unknown>,
  field: string,
  maxLength: number,
): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new SettingsInputError(`${field} must be a string`);
  if (value.length > maxLength) throw new SettingsInputError(`${field} is too long`);
  if (/\r|\n|\0/.test(value)) throw new SettingsInputError(`${field} contains a forbidden control character`);
  return value.trim();
}

function parseSettingsUpdate(input: unknown): SettingsUpdate {
  if (!isRecord(input)) throw new SettingsInputError('Settings payload must be an object');
  for (const field of Object.keys(input)) {
    if (!ALLOWED_UPDATE_FIELDS.has(field)) throw new SettingsInputError(`Unknown settings field: ${field}`);
  }

  const provider = optionalString(input, 'provider', 32);
  if (provider !== undefined && !PROVIDERS.includes(provider as AIProvider)) {
    throw new SettingsInputError(`Invalid provider. Valid: ${PROVIDERS.join(', ')}`);
  }

  const riskMode = optionalString(input, 'riskMode', 16);
  if (riskMode !== undefined && !RISK_MODES.includes(riskMode as RiskMode)) {
    throw new SettingsInputError(`Invalid riskMode. Valid: ${RISK_MODES.join(', ')}`);
  }

  const ticker = optionalString(input, 'ticker', 32);
  if (ticker !== undefined && !resolveSymbol(ticker)) {
    throw new SettingsInputError(`Unknown ticker: ${ticker}`);
  }

  let customModels: string[] | undefined;
  if (input.customModels !== undefined) {
    if (!Array.isArray(input.customModels) || input.customModels.length > 100) {
      throw new SettingsInputError('customModels must be an array with at most 100 items');
    }
    const unique = new Set<string>();
    for (const value of input.customModels) {
      if (typeof value !== 'string') throw new SettingsInputError('Every custom model must be a string');
      const model = value.trim();
      if (!model || model.length > 200 || /\r|\n|\0|,/.test(model)) {
        throw new SettingsInputError('Custom model identifiers must be 1-200 characters without commas or control characters');
      }
      unique.add(model);
    }
    customModels = [...unique];
  }

  return {
    provider: provider as AIProvider | undefined,
    model: optionalString(input, 'model', 200),
    ticker,
    riskMode: riskMode as RiskMode | undefined,
    nvidiaKey: optionalString(input, 'nvidiaKey', 8_192),
    githubToken: optionalString(input, 'githubToken', 8_192),
    customKey: optionalString(input, 'customKey', 8_192),
    customUrl: optionalString(input, 'customUrl', 2_048),
    customModels,
  };
}

function customModelsPayload() {
  const persisted = parseCustomModels(process.env.CUSTOM_AI_MODELS);
  const current = config.custom.model;
  const list = [...persisted];
  if (current && !list.some((model) => model.id === current)) {
    list.unshift({ id: current, label: current });
  }
  return list;
}

function settingsPayload() {
  const customModels = customModelsPayload();
  return {
    provider: config.aiProvider,
    model: config.aiModel,
    endpoint: config.aiEndpoint,
    ticker: config.ticker,
    riskMode: config.riskMode,
    hasGithubToken: Boolean(config.github.token),
    hasNvidiaKey: Boolean(config.nvidia.apiKey),
    hasCustomKey: Boolean(config.custom.apiKey),
    customUrl: config.custom.endpoint,
    availableModels:
      config.aiProvider === 'nvidia' ? NVIDIA_MODELS :
      config.aiProvider === 'github' ? GITHUB_MODELS :
      config.aiProvider === 'custom' ? customModels : [],
    allModels: [
      ...GITHUB_MODELS.map((model) => ({ ...model, provider: 'github' })),
      ...NVIDIA_MODELS.map((model) => ({ ...model, provider: 'nvidia' })),
      ...customModels.map((model) => ({ ...model, provider: 'custom' })),
    ],
  };
}

function setProcessEnv(key: SettingsEnvKey, value: string | null): void {
  if (value === null) delete process.env[key];
  else process.env[key] = value;
}

function publicSettingsError(error: unknown): { message: string; status: number } {
  if (error instanceof PayloadTooLargeError) return { message: error.message, status: 413 };
  if (error instanceof UnsupportedMediaTypeError) return { message: error.message, status: 415 };
  if (
    error instanceof SettingsInputError ||
    error instanceof InvalidJsonBodyError ||
    error instanceof SettingsValidationError ||
    error instanceof UnsafeOutboundUrlError
  ) {
    return { message: error.message, status: 400 };
  }
  return { message: 'Unable to update settings', status: 500 };
}

export async function GET() {
  try {
    return jsonResponse(settingsPayload());
  } catch (error) {
    log.error('settings', error instanceof Error ? error.message : 'Unknown settings read error');
    return errorResponse('Unable to load settings');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = parseSettingsUpdate(await parseBody<unknown>(request));
    const targetProvider = body.provider ?? config.aiProvider;
    const envUpdates: SettingsEnvUpdates = {};

    let customEndpoint: string | undefined;
    if (body.customUrl !== undefined) {
      customEndpoint = await validateCustomProviderEndpoint(body.customUrl || 'http://localhost:20128/v1');
      envUpdates.CUSTOM_AI_URL = customEndpoint;
      if (customEndpoint !== config.custom.endpoint && body.customKey === undefined) {
        // Provider credentials are bound to the endpoint the user entered them for.
        // Moving the endpoint requires re-entering the key, preventing silent reuse
        // of a retained credential at a newly selected server.
        envUpdates.CUSTOM_AI_KEY = null;
      }
    }

    let customModelIds = body.customModels ?? parseCustomModels(process.env.CUSTOM_AI_MODELS).map((model) => model.id);
    if (body.model && targetProvider === 'custom' && !customModelIds.includes(body.model)) {
      customModelIds = [...customModelIds, body.model];
    }
    if (body.customModels !== undefined || (body.model && targetProvider === 'custom')) {
      envUpdates.CUSTOM_AI_MODELS = customModelIds.join(',');
    }

    if (body.provider !== undefined) envUpdates.AI_PROVIDER = body.provider;
    if (body.model !== undefined) {
      const modelKey: Record<AIProvider, SettingsEnvKey> = {
        github: 'GITHUB_AI_MODEL',
        nvidia: 'NVIDIA_AI_MODEL',
        offline: 'OFFLINE_AI_MODEL',
        custom: 'CUSTOM_AI_MODEL',
      };
      envUpdates[modelKey[targetProvider]] = body.model;
    }
    if (body.nvidiaKey !== undefined) envUpdates.NVIDIA_API_KEY = body.nvidiaKey || null;
    if (body.githubToken !== undefined) envUpdates.GITHUB_TOKEN = body.githubToken || null;
    if (body.customKey !== undefined) envUpdates.CUSTOM_AI_KEY = body.customKey || null;

    if (Object.keys(envUpdates).length > 0) {
      await settingsRepository.update(envUpdates);
      for (const [key, value] of Object.entries(envUpdates)) {
        setProcessEnv(key as SettingsEnvKey, value ?? null);
      }
    }

    if (customEndpoint !== undefined) config.setCustomEndpoint(customEndpoint);
    if (body.customModels !== undefined || (body.model && targetProvider === 'custom')) {
      config.custom.models = parseCustomModels(customModelIds.join(','));
    }
    if (body.provider !== undefined) config.setAIProvider(body.provider);
    if (body.model !== undefined) config.setAIModel(body.model);
    if (body.ticker !== undefined) config.setTicker(body.ticker);
    if (body.riskMode !== undefined) config.setRiskMode(body.riskMode);

    return jsonResponse({ message: 'Settings updated', ...settingsPayload() });
  } catch (error) {
    const response = publicSettingsError(error);
    if (response.status === 500) {
      log.error('settings', error instanceof Error ? error.message : 'Unknown settings update error');
    }
    return errorResponse(response.message, response.status);
  }
}
