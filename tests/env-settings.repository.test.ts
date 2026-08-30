import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EnvSettingsRepository,
  SettingsValidationError,
} from '../src/services/settings/env-settings.repository';

describe('EnvSettingsRepository', () => {
  let directory: string;
  let envPath: string;
  let repository: EnvSettingsRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'boz-settings-'));
    envPath = join(directory, '.env');
    repository = new EnvSettingsRepository(() => envPath);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('updates only approved settings and preserves unrelated entries', async () => {
    await writeFile(envPath, '# user setting\nUNRELATED=value\nGITHUB_TOKEN=old\n', 'utf8');

    await repository.update({
      GITHUB_TOKEN: 'new-token',
      CUSTOM_AI_URL: 'https://models.example.test/v1',
    });

    expect(await readFile(envPath, 'utf8')).toBe(
      '# user setting\nUNRELATED=value\nGITHUB_TOKEN=new-token\nCUSTOM_AI_URL=https://models.example.test/v1\n',
    );
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('removes a credential when its value is null', async () => {
    await writeFile(envPath, 'GITHUB_TOKEN=secret\nAI_PROVIDER=github\n', 'utf8');

    await repository.update({ GITHUB_TOKEN: null });

    expect(await readFile(envPath, 'utf8')).toBe('AI_PROVIDER=github\n');
  });

  it('serializes concurrent updates without losing either change', async () => {
    await Promise.all([
      repository.update({ GITHUB_TOKEN: 'github-secret' }),
      repository.update({ NVIDIA_API_KEY: 'nvidia-secret' }),
    ]);

    const result = await readFile(envPath, 'utf8');
    expect(result).toContain('GITHUB_TOKEN=github-secret\n');
    expect(result).toContain('NVIDIA_API_KEY=nvidia-secret\n');
  });

  it('rejects dotenv injection characters', async () => {
    await expect(repository.update({ GITHUB_TOKEN: 'safe\nINJECTED=value' }))
      .rejects.toBeInstanceOf(SettingsValidationError);
  });
});
