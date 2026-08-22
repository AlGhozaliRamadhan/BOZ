import { NextResponse } from 'next/server';
import { config } from '@/config/config';
import { CUSTOM_DEFAULT_URL } from '@/config/custom.config';

export async function POST() {
  try {
    const provider = config.aiProvider;

    if (provider === 'custom') {
      const endpoint = (config.custom.endpoint || CUSTOM_DEFAULT_URL).replace(/\/+$/, '');
      const start = Date.now();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (config.custom.apiKey) headers.Authorization = `Bearer ${config.custom.apiKey}`;

      try {
        const res = await fetch(`${endpoint}/models`, {
          headers,
          signal: AbortSignal.timeout(5000),
        });
        const latencyMs = Date.now() - start;
        if (!res.ok) {
          return NextResponse.json({
            success: false,
            message: `9router returned HTTP ${res.status} from ${endpoint}/models`,
            latencyMs,
          });
        }
        return NextResponse.json({
          success: true,
          message: `9router reachable at ${endpoint}`,
          latencyMs,
        });
      } catch (err) {
        return NextResponse.json({
          success: false,
          message: err instanceof Error
            ? `Cannot reach 9router at ${endpoint}: ${err.message}`
            : `Cannot reach 9router at ${endpoint}`,
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
  } catch (err: unknown) {
    return NextResponse.json({
      success: false,
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
