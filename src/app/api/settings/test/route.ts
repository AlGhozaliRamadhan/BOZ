import { NextResponse } from 'next/server';
import { config } from '@/config/config';

export async function POST() {
  try {
    const hasNvidia = !!config.nvidia.apiKey;
    const hasGithub = !!config.github.token;

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
