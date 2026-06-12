import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, parseBody } from '@/app/lib/api-helpers';
import { config } from '@/config/config';
import type { AIProvider, RiskMode } from '@/config/config';
import { GITHUB_MODELS } from '@/config/github.config';
import { NVIDIA_MODELS } from '@/config/nvidia.config';
import * as fs from 'fs';
import * as path from 'path';

function sanitizeEnvValue(value: string): string {
  return value
    .replace(/[\r\n\t]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

function upsertEnvVar(key: string, value: string): void {
  const safe     = sanitizeEnvValue(value);
  const envPath  = path.resolve(process.cwd(), '.env');
  let   contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const lineRe   = new RegExp('^' + key + '=.*$', 'm');
  const line     = `${key}=${safe}`;
  if (lineRe.test(contents)) {
    contents = contents.replace(lineRe, line);
  } else {
    contents = contents.trimEnd();
    contents = contents ? `${contents}\n${line}\n` : `${line}\n`;
  }
  fs.writeFileSync(envPath, contents, 'utf8');
}

export async function GET() {
  try {
    return jsonResponse({
      provider:       config.aiProvider,
      model:          config.aiModel,
      endpoint:       config.aiEndpoint,
      ticker:         config.ticker,
      riskMode:       config.riskMode,
      hasGithubToken: !!config.github.token,
      hasNvidiaKey:   !!config.nvidia.apiKey,
      nvidiaKey:      config.nvidia.apiKey || '',
      githubToken:    config.github.token || '',
      availableModels: config.aiProvider === 'nvidia' ? NVIDIA_MODELS : 
                       config.aiProvider === 'github' ? GITHUB_MODELS : [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await parseBody<{
      provider?: AIProvider;
      model?: string;
      ticker?: string;
      riskMode?: RiskMode;
      nvidiaKey?: string;
      githubToken?: string;
    }>(request);

    if (body.provider) {
      const valid: AIProvider[] = ['github', 'offline', 'nvidia'];
      if (!valid.includes(body.provider)) {
        return errorResponse(`Invalid provider. Valid: ${valid.join(', ')}`, 400);
      }
      config.setAIProvider(body.provider);
      process.env.AI_PROVIDER = body.provider;
      upsertEnvVar('AI_PROVIDER', body.provider);
    }

    if (body.model) {
      config.setAIModel(body.model);
      const prov = config.aiProvider;
      if (prov === 'nvidia') {
        process.env.NVIDIA_AI_MODEL = body.model;
        upsertEnvVar('NVIDIA_AI_MODEL', body.model);
      } else if (prov === 'github') {
        process.env.GITHUB_AI_MODEL = body.model;
        upsertEnvVar('GITHUB_AI_MODEL', body.model);
      } else if (prov === 'offline') {
        process.env.OFFLINE_AI_MODEL = body.model;
        upsertEnvVar('OFFLINE_AI_MODEL', body.model);
      }
    }

    if (body.ticker) {
      try {
        config.setTicker(body.ticker);
      } catch {
        return errorResponse(`Unknown ticker: ${body.ticker}`, 400);
      }
    }

    if (body.riskMode) {
      const valid: RiskMode[] = ['auto', 'on', 'off'];
      if (!valid.includes(body.riskMode)) {
        return errorResponse(`Invalid riskMode. Valid: ${valid.join(', ')}`, 400);
      }
      config.setRiskMode(body.riskMode);
    }

    if (body.nvidiaKey !== undefined) {
      process.env.NVIDIA_API_KEY = body.nvidiaKey;
      upsertEnvVar('NVIDIA_API_KEY', body.nvidiaKey);
    }

    if (body.githubToken !== undefined) {
      process.env.GITHUB_TOKEN = body.githubToken;
      upsertEnvVar('GITHUB_TOKEN', body.githubToken);
    }

    return jsonResponse({
      message: 'Settings updated',
      provider:       config.aiProvider,
      model:          config.aiModel,
      endpoint:       config.aiEndpoint,
      ticker:         config.ticker,
      riskMode:       config.riskMode,
      hasGithubToken: !!config.github.token,
      hasNvidiaKey:   !!config.nvidia.apiKey,
      nvidiaKey:      config.nvidia.apiKey || '',
      githubToken:    config.github.token || '',
      availableModels: config.aiProvider === 'nvidia' ? NVIDIA_MODELS : 
                       config.aiProvider === 'github' ? GITHUB_MODELS : [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse(msg);
  }
}

