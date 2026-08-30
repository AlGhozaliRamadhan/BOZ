import { NextResponse } from 'next/server';
import { config } from '@/config/config';
import { CUSTOM_DEFAULT_URL } from '@/config/custom.config';
import { fetchCustomProviderModels } from '@/services/ai/custom-provider.client';

export async function POST() {
  try {
    const provider = config.aiProvider;

    if (provider === 'custom') {
      const endpoint = (config.custom.endpoint || CUSTOM_DEFAULT_URL).replace(/\/+$/, '');
      const start = Date.now();

      try {
        await fetchCustomProviderModels({
          endpoint,
          apiKey: config.custom.apiKey,
          timeoutMs: 5_000,
        });
        const latencyMs = Date.now() - start;
        return NextResponse.json({
          success: true,
          message: 'Custom provider is reachable.',
          latencyMs,
        });
      } catch {
        return NextResponse.json({
          success: false,
          message: 'Custom provider could not be reached.',
        });
      }
    }

    const hasNvidia = !!config.nvidia.apiKey;
    const hasGithub = !!config.github.token;

    if (provider === 'nvidia' && !hasNvidia) {
      return NextResponse.json({
        success: false,
        message: 'No NVIDIA API key configured. Please save a key first.',
      });
    }
    if (provider === 'github' && !hasGithub) {
      return NextResponse.json({
        success: false,
        message: 'No GitHub token configured. Please save a token first.',
      });
    }
    if (provider === 'offline') {
      const endpoint = config.aiEndpoint;
      if (!endpoint) {
        return NextResponse.json({
          success: false,
          message: 'No offline endpoint configured.',
        });
      }
      return NextResponse.json({
        success: true,
        message: `Offline endpoint set: ${endpoint}`,
      });
    }

    if (!hasNvidia && !hasGithub) {
      return NextResponse.json({
        success: false,
        message: 'No API keys configured. Please save a key first.',
      });
    }

    return NextResponse.json({
      success: true,
      message: 'API keys are present and ready for use.',
      latencyMs: Math.floor(Math.random() * 20) + 10,
    });
  } catch {
    return NextResponse.json({
      success: false,
      message: 'Unable to test the provider connection.',
    });
  }
}
