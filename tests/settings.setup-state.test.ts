import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '../src/app/api/settings/route';
import { config } from '../src/config/config';

// Setup-state truth for the chat UI: a fresh install (custom provider, no
// model, no key anywhere) must surface "not set up — no model" instead of
// implying a provider the first message would reject.
describe('settings payload setup state', { concurrent: false }, () => {
  let configDirectory: string;
  const original = {
    configDir: process.env.BOZ_CONFIG_DIR,
    provider: config.aiProvider,
    model: config.aiModel,
    customModel: process.env.CUSTOM_AI_MODEL,
    openrouterKey: process.env.OPENROUTER_API_KEY,
    customUrl: process.env.CUSTOM_AI_URL,
  };

  beforeAll(async () => {
    configDirectory = await mkdtemp(join(tmpdir(), 'boz-setup-state-'));
    process.env.BOZ_CONFIG_DIR = configDirectory;
    // Drive the singleton explicitly so the assertions hold regardless of a
    // developer machine's local .env.
    for (const key of ['OPENROUTER_API_KEY', 'CUSTOM_AI_MODEL', 'CUSTOM_AI_URL', 'GITHUB_TOKEN'] as const) {
      delete process.env[key];
    }
    config.setAIProvider('custom');
    config.setAIModel('', 'custom');
  });

  afterAll(async () => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('BOZ_CONFIG_DIR', original.configDir);
    restore('OPENROUTER_API_KEY', original.openrouterKey);
    restore('CUSTOM_AI_MODEL', original.customModel);
    restore('CUSTOM_AI_URL', original.customUrl);
    if (original.model) config.setAIModel(original.model, original.provider);
    config.setAIProvider(original.provider);
    await rm(configDirectory, { recursive: true, force: true });
  });

  it('reports not-configured with no model and no credential', async () => {
    const response = await GET();
    const payload = await response.json();

    expect(payload.setup).toEqual({ configured: false, issue: 'no-model' });
  });

  it('reports not-configured for a placeholder model even with a credential', async () => {
    process.env.OPENROUTER_API_KEY = 'setup-test-key';
    config.setAIProvider('openrouter');
    // Every shipped provider carries a default model, so the no-model branch
    // for cloud providers means a `~` placeholder — the fresh-install marker
    // the settings flow writes before a model is picked.
    config.setAIModel('~placeholder', 'openrouter');

    const response = await GET();
    const payload = await response.json();

    expect(payload.setup).toEqual({ configured: false, issue: 'no-model' });
  });

  it('reports configured once the provider has a model and credential', async () => {
    process.env.OPENROUTER_API_KEY = 'setup-test-key';
    config.setAIProvider('openrouter');
    config.setAIModel('openai/gpt-5-mini', 'openrouter');

    const response = await GET();
    const payload = await response.json();

    expect(payload.setup).toEqual({ configured: true, issue: null });
  });

  it('reports configured for the custom provider once it has a model', async () => {
    config.setAIProvider('custom');
    config.setAIModel('my-9router-model', 'custom');

    const response = await GET();
    const payload = await response.json();

    // Custom (9router) counts its model as the credential — same rule as the
    // chat engine preflight.
    expect(payload.setup).toEqual({ configured: true, issue: null });
  });
});
