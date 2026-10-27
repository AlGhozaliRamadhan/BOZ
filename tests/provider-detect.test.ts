import { describe, expect, it } from 'vitest';
import { isLocalAiEndpoint, resolveUnconfiguredProvider } from '../src/shared/provider-detect.js';

describe('isLocalAiEndpoint', () => {
  it('recognises loopback router endpoints', () => {
    expect(isLocalAiEndpoint('http://localhost:20128/v1')).toBe(true);
    expect(isLocalAiEndpoint('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isLocalAiEndpoint('http://[::1]:8080/v1')).toBe(true);
    expect(isLocalAiEndpoint('localhost:20128/v1')).toBe(true);
  });

  it('does not treat the hosted APIs as local', () => {
    expect(isLocalAiEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(isLocalAiEndpoint('https://openrouter.ai/api/v1')).toBe(false);
  });

  it('ignores empty and unparseable values', () => {
    expect(isLocalAiEndpoint(undefined)).toBe(false);
    expect(isLocalAiEndpoint('   ')).toBe(false);
    expect(isLocalAiEndpoint('http://')).toBe(false);
  });
});

describe('resolveUnconfiguredProvider', () => {
  it('defaults to the local provider when nothing is configured', () => {
    expect(resolveUnconfiguredProvider({})).toBe('custom');
  });

  it('treats a loopback OPENAI_BASE_URL as the local router, not OpenAI', () => {
    // The 9router setup guide tells users to export these two names. Reading
    // them as "the user chose OpenAI" is what made OpenAI the active provider
    // on a machine that never configured it.
    expect(resolveUnconfiguredProvider({
      OPENAI_API_KEY: 'router-key',
      OPENAI_BASE_URL: 'http://127.0.0.1:20128/v1',
    })).toBe('custom');
  });

  it('detects OpenAI from a hosted endpoint', () => {
    expect(resolveUnconfiguredProvider({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    })).toBe('openai');
    expect(resolveUnconfiguredProvider({ OPENAI_API_KEY: 'sk-test' })).toBe('openai');
  });

  it('prefers an explicit 9router configuration', () => {
    expect(resolveUnconfiguredProvider({
      CUSTOM_AI_URL: 'http://localhost:20128/v1',
      OPENAI_API_KEY: 'sk-test',
    })).toBe('custom');
    expect(resolveUnconfiguredProvider({
      CUSTOM_AI_MODEL: 'nvidia/some-model',
      OPENROUTER_API_KEY: 'router-key',
    })).toBe('custom');
  });

  it('still detects the hosted providers from their own keys', () => {
    expect(resolveUnconfiguredProvider({ OPENROUTER_API_KEY: 'k' })).toBe('openrouter');
    expect(resolveUnconfiguredProvider({ ANTHROPIC_API_KEY: 'k' })).toBe('anthropic');
    expect(resolveUnconfiguredProvider({ GROQ_API_KEY: 'k' })).toBe('groq');
    expect(resolveUnconfiguredProvider({ NVIDIA_API_KEY: 'k' })).toBe('nvidia');
    expect(resolveUnconfiguredProvider({ GITHUB_TOKEN: 'k' })).toBe('github');
    expect(resolveUnconfiguredProvider({ OFFLINE_AI_URL: 'http://localhost:11434' })).toBe('offline');
  });
});
