import { NextResponse } from 'next/server';
import { config } from '@/config/config';
import { CUSTOM_DEFAULT_URL } from '@/config/custom.config';
import { fetchCustomProviderModels } from '@/services/ai/custom-provider.client';

async function verifyOpenAiCompatibleProvider(
  endpoint: string,
  apiKey: string,
  providerName: string,
): Promise<Response> {
  return fetch(`${endpoint.replace(/\/+$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5_000),
  }).then((response) => {
    if (!response.ok) throw new Error(`${providerName} returned HTTP ${response.status}`);
    return response;
  });
}

async function verifyAnthropicProvider(): Promise<void> {
  const response = await fetch(`${config.anthropic.endpoint}/messages/count_tokens`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropic.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      messages: [{ role: 'user', content: 'Connection check' }],
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Anthropic returned HTTP ${response.status}`);
}

export async function POST() {
  try {
    const provider = config.aiProvider;
    const start = Date.now();

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
    const hasOpenai = !!config.openai.apiKey;
    const hasAnthropic = !!config.anthropic.apiKey;
    const hasGroq = !!config.groq.apiKey;
    const hasOpenrouter = !!config.openrouter.apiKey;

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
      const endpoint = config.offline.endpoint;
      if (!endpoint) {
        return NextResponse.json({
          success: false,
          message: 'No offline endpoint configured.',
        });
      }
      const response = await fetch(`${endpoint.replace(/\/+$/, '')}/api/tags`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
      return NextResponse.json({
        success: true,
        message: 'Ollama is reachable.',
        latencyMs: Date.now() - start,
      });
    }
    if (provider === 'openai' && !hasOpenai) {
      return NextResponse.json({ success: false, message: 'No OpenAI API key configured. Please save a key first.' });
    }
    if (provider === 'anthropic' && !hasAnthropic) {
      return NextResponse.json({ success: false, message: 'No Anthropic API key configured. Please save a key first.' });
    }
    if (provider === 'groq' && !hasGroq) {
      return NextResponse.json({ success: false, message: 'No Groq API key configured. Please save a key first.' });
    }
    if (provider === 'openrouter' && !hasOpenrouter) {
      return NextResponse.json({ success: false, message: 'No OpenRouter API key configured. Please save a key first.' });
    }

    if (provider === 'github') {
      await verifyOpenAiCompatibleProvider(config.github.endpoint, config.github.token, 'GitHub Models');
      return NextResponse.json({
        success: true,
        message: 'GitHub Models credentials are valid.',
        latencyMs: Date.now() - start,
      });
    }

    if (provider === 'nvidia') {
      await verifyOpenAiCompatibleProvider(config.nvidia.baseURL, config.nvidia.apiKey, 'NVIDIA NIM');
      return NextResponse.json({
        success: true,
        message: 'NVIDIA NIM credentials are valid.',
        latencyMs: Date.now() - start,
      });
    }

    if (provider === 'openai') {
      await verifyOpenAiCompatibleProvider(config.openai.endpoint, config.openai.apiKey, 'OpenAI');
      return NextResponse.json({ success: true, message: 'OpenAI credentials are valid.', latencyMs: Date.now() - start });
    }

    if (provider === 'anthropic') {
      await verifyAnthropicProvider();
      return NextResponse.json({ success: true, message: 'Anthropic credentials are valid.', latencyMs: Date.now() - start });
    }

    if (provider === 'groq') {
      await verifyOpenAiCompatibleProvider(config.groq.endpoint, config.groq.apiKey, 'Groq');
      return NextResponse.json({ success: true, message: 'Groq credentials are valid.', latencyMs: Date.now() - start });
    }

    if (provider === 'openrouter') {
      await verifyOpenAiCompatibleProvider(config.openrouter.endpoint, config.openrouter.apiKey, 'OpenRouter');
      return NextResponse.json({ success: true, message: 'OpenRouter credentials are valid.', latencyMs: Date.now() - start });
    }

    return NextResponse.json({
      success: false,
      message: 'Unsupported provider.',
    });
  } catch {
    return NextResponse.json({
      success: false,
      message: 'Unable to reach the provider. Check the endpoint and credential, then try again.',
    });
  }
}
