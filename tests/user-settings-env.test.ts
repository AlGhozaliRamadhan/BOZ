import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadUserSettingsEnv, parseSettingsDocument } from '../src/services/settings/user-env.js';

// Settings saved in the app live in `<config dir>/.env`. The packaged sidecar
// never had a reader for that file, so a saved provider reverted to whatever
// the ambient environment implied on the next launch.
describe('loadUserSettingsEnv', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function envFile(contents: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'boz-user-env-'));
    directories.push(dir);
    const file = join(dir, '.env');
    await writeFile(file, contents, 'utf8');
    return file;
  }

  it('applies saved settings the process does not already have', async () => {
    const file = await envFile('AI_PROVIDER=custom\nCUSTOM_AI_MODEL=nvidia/some-model\n');
    const env: NodeJS.ProcessEnv = {};

    const loaded = loadUserSettingsEnv(file, env);

    expect(env.AI_PROVIDER).toBe('custom');
    expect(env.CUSTOM_AI_MODEL).toBe('nvidia/some-model');
    expect(loaded.applied.sort()).toEqual(['AI_PROVIDER', 'CUSTOM_AI_MODEL']);
  });

  it('keeps an ambient value that is already set', async () => {
    const file = await envFile('AI_PROVIDER=custom\n');
    const env: NodeJS.ProcessEnv = { AI_PROVIDER: 'openai' };

    const loaded = loadUserSettingsEnv(file, env);

    expect(env.AI_PROVIDER).toBe('openai');
    expect(loaded.applied).toEqual([]);
  });

  it('ignores keys outside the settings allow-list', async () => {
    const file = await envFile('AI_PROVIDER=custom\nNODE_OPTIONS=--require=./evil.js\n');
    const env: NodeJS.ProcessEnv = {};

    loadUserSettingsEnv(file, env);

    expect(env.AI_PROVIDER).toBe('custom');
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it('keeps values that contain an equals sign, such as base64 keys', () => {
    expect(parseSettingsDocument('CUSTOM_AI_KEY=abc+/123==')).toEqual({ CUSTOM_AI_KEY: 'abc+/123==' });
  });

  it('strips one pair of wrapping quotes', () => {
    expect(parseSettingsDocument('CUSTOM_AI_MODEL="ollama/gpt-oss:120b"\n')).toEqual({
      CUSTOM_AI_MODEL: 'ollama/gpt-oss:120b',
    });
    expect(parseSettingsDocument("AI_PROVIDER='custom'\n")).toEqual({ AI_PROVIDER: 'custom' });
  });

  it('skips comments, blanks, and malformed lines', () => {
    expect(parseSettingsDocument('# a comment\n\nAI_PROVIDER=custom\n;rubbish\nno_separator\n')).toEqual({
      AI_PROVIDER: 'custom',
    });
  });

  it('tolerates an export prefix and CRLF endings, like dotenv', () => {
    expect(parseSettingsDocument('export AI_PROVIDER=custom\r\n')).toEqual({ AI_PROVIDER: 'custom' });
  });

  it('reports nothing applied when the file does not exist', async () => {
    const file = join(tmpdir(), 'boz-user-env-missing', '.env');

    expect(loadUserSettingsEnv(file, {})).toEqual({ path: file, applied: [] });
  });
});
