export const PROFILE_STORAGE_KEY = 'boz_profile_v1';
export const PROFILE_EVENT = 'boz_profile_updated';

export const PROFILE_AVATAR_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#94a3b8',
] as const;

export interface UserProfile {
  displayName: string;
  status: string;
  avatarColor: string;
}

export const DEFAULT_PROFILE: UserProfile = {
  displayName: 'User',
  status: '',
  avatarColor: PROFILE_AVATAR_COLORS[0],
};

export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_PROFILE.displayName;
  const trimmed = value.trim().replace(/[\r\n\0]/g, '');
  if (!trimmed) return DEFAULT_PROFILE.displayName;
  return trimmed.slice(0, 32);
}

function sanitizeStatus(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\r\n\0]/g, '').slice(0, 60);
}

function sanitizeColor(value: unknown): string {
  if (typeof value === 'string' && (PROFILE_AVATAR_COLORS as readonly string[]).includes(value)) {
    return value;
  }
  return DEFAULT_PROFILE.avatarColor;
}

export function readProfile(storage: ProfileStorage): UserProfile {
  try {
    const raw = storage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_PROFILE };
    }
    return {
      displayName: sanitizeName(parsed.displayName),
      status: sanitizeStatus(parsed.status),
      avatarColor: sanitizeColor(parsed.avatarColor),
    };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function writeProfile(storage: ProfileStorage, profile: UserProfile): void {
  storage.setItem(
    PROFILE_STORAGE_KEY,
    JSON.stringify({
      displayName: sanitizeName(profile.displayName),
      status: sanitizeStatus(profile.status),
      avatarColor: sanitizeColor(profile.avatarColor),
      updatedAt: new Date().toISOString(),
    }),
  );
}

export function profileInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.toLowerCase() === 'user') return '';
  const first = Array.from(trimmed)[0];
  return first ? first.toUpperCase() : '';
}
