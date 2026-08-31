import { getBuildVersion } from './version.js';

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  checkedAt: number;
  packageUrl: string;
  updateCommand: string;
  error?: string;
}

export const NPM_PACKAGE_NAME = '@agr77/boz';
export const NPM_REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(NPM_PACKAGE_NAME)}/latest`;
export const NPM_PACKAGE_URL = `https://www.npmjs.com/package/${NPM_PACKAGE_NAME}`;
export const DEFAULT_UPDATE_COMMAND = `npm i -g ${NPM_PACKAGE_NAME}`;
export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const SEMVER_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseSemver(versionStr: string): Semver | null {
  if (!versionStr || typeof versionStr !== 'string') return null;
  const match = versionStr.trim().match(SEMVER_REGEX);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || undefined,
  };
}

function comparePrerelease(p1?: string, p2?: string): number {
  if (!p1 && !p2) return 0;
  if (!p1 && p2) return 1;
  if (p1 && !p2) return -1;

  if (p1 === p2) return 0;

  const parts1 = (p1 || '').split('.');
  const parts2 = (p2 || '').split('.');
  const minLen = Math.min(parts1.length, parts2.length);

  for (let i = 0; i < minLen; i++) {
    const a = parts1[i];
    const b = parts2[i];
    if (a === b) continue;

    const numA = Number(a);
    const numB = Number(b);
    const aIsNum = !Number.isNaN(numA) && /^\d+$/.test(a);
    const bIsNum = !Number.isNaN(numB) && /^\d+$/.test(b);

    if (aIsNum && bIsNum) {
      return numA > numB ? 1 : -1;
    }
    if (aIsNum && !bIsNum) {
      return -1;
    }
    if (!aIsNum && bIsNum) {
      return 1;
    }
    return a.localeCompare(b) > 0 ? 1 : -1;
  }

  return parts1.length > parts2.length ? 1 : parts1.length < parts2.length ? -1 : 0;
}

export function compareSemver(v1Str: string, v2Str: string): number {
  const v1 = parseSemver(v1Str);
  const v2 = parseSemver(v2Str);

  if (!v1 && !v2) return 0;
  if (!v1) return -1;
  if (!v2) return 1;

  if (v1.major !== v2.major) return v1.major > v2.major ? 1 : -1;
  if (v1.minor !== v2.minor) return v1.minor > v2.minor ? 1 : -1;
  if (v1.patch !== v2.patch) return v1.patch > v2.patch ? 1 : -1;

  return comparePrerelease(v1.prerelease, v2.prerelease);
}

export function isNewerVersion(latestVersion: string, currentVersion: string): boolean {
  return compareSemver(latestVersion, currentVersion) > 0;
}

interface CacheEntry {
  result: UpdateCheckResult;
  expiresAt: number;
}

let cachedEntry: CacheEntry | null = null;

export function clearUpdateCache(): void {
  cachedEntry = null;
}

export function getCachedUpdateResult(): UpdateCheckResult | null {
  if (cachedEntry && Date.now() < cachedEntry.expiresAt) {
    return cachedEntry.result;
  }
  return null;
}

export interface CheckForUpdatesOptions {
  currentVersion?: string;
  force?: boolean;
  timeoutMs?: number;
  registryUrl?: string;
  fetchFn?: typeof fetch;
  cacheTtlMs?: number;
}

export async function fetchLatestNpmVersion(
  registryUrl = NPM_REGISTRY_URL,
  options?: { timeoutMs?: number; fetchFn?: typeof fetch },
): Promise<string> {
  const fetcher = options?.fetchFn ?? globalThis.fetch;
  const timeoutMs = options?.timeoutMs ?? 3000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(registryUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'BOZ-UpdateCheck',
      },
    });

    if (!response.ok) {
      throw new Error(`NPM registry returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as { version?: string };
    if (!data || typeof data.version !== 'string') {
      throw new Error('Invalid response from NPM registry');
    }

    return data.version.trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForUpdates(options: CheckForUpdatesOptions = {}): Promise<UpdateCheckResult> {
  const currentVersion = options.currentVersion ?? getBuildVersion();
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const now = Date.now();

  if (!options.force && cachedEntry && now < cachedEntry.expiresAt) {
    return cachedEntry.result;
  }

  try {
    const latestVersion = await fetchLatestNpmVersion(options.registryUrl, {
      timeoutMs: options.timeoutMs,
      fetchFn: options.fetchFn,
    });

    const updateAvailable = isNewerVersion(latestVersion, currentVersion);

    const result: UpdateCheckResult = {
      currentVersion,
      latestVersion,
      updateAvailable,
      checkedAt: now,
      packageUrl: NPM_PACKAGE_URL,
      updateCommand: DEFAULT_UPDATE_COMMAND,
    };

    cachedEntry = {
      result,
      expiresAt: now + cacheTtlMs,
    };

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const fallbackResult: UpdateCheckResult = {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      checkedAt: now,
      packageUrl: NPM_PACKAGE_URL,
      updateCommand: DEFAULT_UPDATE_COMMAND,
      error: errorMessage,
    };

    if (!options.force) {
      cachedEntry = {
        result: fallbackResult,
        expiresAt: now + 5 * 60 * 1000,
      };
    }

    return fallbackResult;
  }
}
