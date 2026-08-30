import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, PUT } from '../src/app/api/settings/route';

describe.sequential('settings route security boundary', () => {
  let configDirectory: string;
  const original = {
    configDir: process.env.BOZ_CONFIG_DIR,
    githubToken: process.env.GITHUB_TOKEN,
    nvidiaKey: process.env.NVIDIA_API_KEY,
    customKey: process.env.CUSTOM_AI_KEY,
  };

  beforeAll(async () => {
    configDirectory = await mkdtemp(join(tmpdir(), 'boz-settings-route-'));
    process.env.BOZ_CONFIG_DIR = configDirectory;
    process.env.GITHUB_TOKEN = 'github-secret-value';
    process.env.NVIDIA_API_KEY = 'nvidia-secret-value';
    process.env.CUSTOM_AI_KEY = 'custom-secret-value';
  });

  afterAll(async () => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore('BOZ_CONFIG_DIR', original.configDir);
    restore('GITHUB_TOKEN', original.githubToken);
    restore('NVIDIA_API_KEY', original.nvidiaKey);
    restore('CUSTOM_AI_KEY', original.customKey);
    await rm(configDirectory, { recursive: true, force: true });
  });

  it('returns only credential-presence metadata', async () => {
    const response = await GET();
    const payload = await response.json();

    expect(payload).toMatchObject({
      hasGithubToken: true,
      hasNvidiaKey: true,
      hasCustomKey: true,
    });
    expect(payload).not.toHaveProperty('githubToken');
    expect(payload).not.toHaveProperty('nvidiaKey');
    expect(payload).not.toHaveProperty('customKey');
    expect(JSON.stringify(payload)).not.toContain('secret-value');
  });

  it('persists a replacement credential without returning it', async () => {
    const request = new Request('http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ githubToken: 'replacement-token' }),
    });
    const response = await PUT(request as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.hasGithubToken).toBe(true);
    expect(JSON.stringify(payload)).not.toContain('replacement-token');
    expect(await readFile(join(configDirectory, '.env'), 'utf8'))
      .toContain('GITHUB_TOKEN=replacement-token\n');
  });

  it('rejects unknown fields and metadata-service endpoints', async () => {
    const unknownResponse = await PUT(new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ surprise: true }),
    }) as never);
    expect(unknownResponse.status).toBe(400);

    const unsafeResponse = await PUT(new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ customUrl: 'http://169.254.169.254/latest' }),
    }) as never);
    expect(unsafeResponse.status).toBe(400);
  });

  it('returns a client error for malformed JSON', async () => {
    const response = await PUT(new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: '{not-json',
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });
});
