import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROFILE,
  PROFILE_STORAGE_KEY,
  profileInitial,
  readProfile,
  writeProfile,
  type ProfileStorage,
} from '@/app/components/layout/profile-state';

function memoryStorage(initial?: Record<string, string>): ProfileStorage & { dump: Record<string, string> } {
  const dump: Record<string, string> = { ...(initial ?? {}) };
  return {
    dump,
    getItem: (key: string) => dump[key] ?? null,
    setItem: (key: string, value: string) => {
      dump[key] = value;
    },
  };
}

describe('profile-state', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readProfile(memoryStorage())).toEqual(DEFAULT_PROFILE);
  });

  it('round-trips a saved profile', () => {
    const storage = memoryStorage();
    writeProfile(storage, { displayName: '  Trader Joe ', status: 'Swing trader', avatarColor: '#22c55e' });
    expect(readProfile(storage)).toEqual({
      displayName: 'Trader Joe',
      status: 'Swing trader',
      avatarColor: '#22c55e',
    });
    expect(JSON.parse(storage.dump[PROFILE_STORAGE_KEY]).displayName).toBe('Trader Joe');
  });

  it('falls back on corrupt storage', () => {
    const storage = memoryStorage({ [PROFILE_STORAGE_KEY]: '{nope' });
    expect(readProfile(storage)).toEqual(DEFAULT_PROFILE);
  });

  it('sanitizes overlong and rogue values', () => {
    const storage = memoryStorage();
    writeProfile(storage, {
      displayName: 'x'.repeat(100),
      status: 'line1\r\nline2',
      avatarColor: 'javascript:alert(1)',
    });
    const profile = readProfile(storage);
    expect(profile.displayName).toHaveLength(32);
    expect(profile.status).toBe('line1line2');
    expect(profile.avatarColor).toBe(DEFAULT_PROFILE.avatarColor);
  });

  it('derives initials, empty for the default name', () => {
    expect(profileInitial('Trader Joe')).toBe('T');
    expect(profileInitial('User')).toBe('');
    expect(profileInitial('  ')).toBe('');
  });
});
