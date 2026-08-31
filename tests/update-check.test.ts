import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkForUpdates,
  clearUpdateCache,
  compareSemver,
  fetchLatestNpmVersion,
  getCachedUpdateResult,
  isNewerVersion,
  parseSemver,
} from '../src/utils/update-check.js';

describe('update-check utility', () => {
  beforeEach(() => {
    clearUpdateCache();
    vi.restoreAllMocks();
  });

  describe('parseSemver', () => {
    it('parses standard semver versions', () => {
      expect(parseSemver('2.4.3')).toEqual({ major: 2, minor: 4, patch: 3, prerelease: undefined });
      expect(parseSemver('v1.0.0')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: undefined });
      expect(parseSemver('0.10.25')).toEqual({ major: 0, minor: 10, patch: 25, prerelease: undefined });
    });

    it('parses prerelease and build metadata', () => {
      expect(parseSemver('2.5.0-beta.1')).toEqual({ major: 2, minor: 5, patch: 0, prerelease: 'beta.1' });
      expect(parseSemver('3.0.0-rc.2+build.123')).toEqual({ major: 3, minor: 0, patch: 0, prerelease: 'rc.2' });
    });

    it('returns null for invalid semver strings', () => {
      expect(parseSemver('')).toBeNull();
      expect(parseSemver('invalid')).toBeNull();
      expect(parseSemver('1.2')).toBeNull();
    });
  });

  describe('compareSemver', () => {
    it('correctly compares major, minor, and patch numbers', () => {
      expect(compareSemver('2.4.3', '2.4.3')).toBe(0);
      expect(compareSemver('2.5.0', '2.4.3')).toBe(1);
      expect(compareSemver('2.4.3', '2.5.0')).toBe(-1);
      expect(compareSemver('3.0.0', '2.9.9')).toBe(1);
      expect(compareSemver('2.4.4', '2.4.3')).toBe(1);
      expect(compareSemver('2.4.2', '2.4.3')).toBe(-1);
    });

    it('correctly handles prerelease versions', () => {
      // Release is higher than prerelease
      expect(compareSemver('2.5.0', '2.5.0-beta.1')).toBe(1);
      expect(compareSemver('2.5.0-beta.1', '2.5.0')).toBe(-1);
      // Prerelease comparison
      expect(compareSemver('2.5.0-beta.2', '2.5.0-beta.1')).toBe(1);
      expect(compareSemver('2.5.0-alpha.1', '2.5.0-beta.1')).toBe(-1);
    });
  });

  describe('isNewerVersion', () => {
    it('returns true only when latest is newer than current', () => {
      expect(isNewerVersion('2.5.0', '2.4.3')).toBe(true);
      expect(isNewerVersion('2.4.4', '2.4.3')).toBe(true);
      expect(isNewerVersion('3.0.0', '2.4.3')).toBe(true);
      expect(isNewerVersion('2.4.3', '2.4.3')).toBe(false);
      expect(isNewerVersion('2.4.2', '2.4.3')).toBe(false);
      expect(isNewerVersion('2.4.3-beta.1', '2.4.3')).toBe(false);
    });
  });

  describe('fetchLatestNpmVersion', () => {
    it('fetches and returns version from registry response', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '2.5.0' }),
      })) as unknown as typeof fetch;

      const version = await fetchLatestNpmVersion('https://registry.npmjs.org/@agr77%2Fboz/latest', {
        fetchFn: mockFetch,
      });

      expect(version).toBe('2.5.0');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('throws when registry returns non-ok status', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: false,
        status: 404,
      })) as unknown as typeof fetch;

      await expect(
        fetchLatestNpmVersion('https://registry.npmjs.org/@agr77%2Fboz/latest', {
          fetchFn: mockFetch,
        }),
      ).rejects.toThrow('NPM registry returned HTTP 404');
    });
  });

  describe('checkForUpdates', () => {
    it('detects available update when npm version is newer', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '2.5.0' }),
      })) as unknown as typeof fetch;

      const result = await checkForUpdates({
        currentVersion: '2.4.3',
        fetchFn: mockFetch,
      });

      expect(result.updateAvailable).toBe(true);
      expect(result.currentVersion).toBe('2.4.3');
      expect(result.latestVersion).toBe('2.5.0');
      expect(result.updateCommand).toBe('npm i -g @agr77/boz');
      expect(getCachedUpdateResult()).toEqual(result);
    });

    it('detects when already on latest version', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '2.4.3' }),
      })) as unknown as typeof fetch;

      const result = await checkForUpdates({
        currentVersion: '2.4.3',
        fetchFn: mockFetch,
      });

      expect(result.updateAvailable).toBe(false);
      expect(result.currentVersion).toBe('2.4.3');
      expect(result.latestVersion).toBe('2.4.3');
    });

    it('uses cached result when available and not forced', async () => {
      const mockFetch = vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '2.5.0' }),
      })) as unknown as typeof fetch;

      const first = await checkForUpdates({
        currentVersion: '2.4.3',
        fetchFn: mockFetch,
      });
      const second = await checkForUpdates({
        currentVersion: '2.4.3',
        fetchFn: mockFetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });

    it('bypasses cache when force is true', async () => {
      let callCount = 0;
      const mockFetch = vi.fn(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({ version: callCount === 1 ? '2.5.0' : '2.6.0' }),
        };
      }) as unknown as typeof fetch;

      const first = await checkForUpdates({
        currentVersion: '2.4.3',
        fetchFn: mockFetch,
      });
      expect(first.latestVersion).toBe('2.5.0');

      const second = await checkForUpdates({
        currentVersion: '2.4.3',
        force: true,
        fetchFn: mockFetch,
      });
      expect(second.latestVersion).toBe('2.6.0');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('handles network failure gracefully without throwing', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Network error');
      }) as unknown as typeof fetch;

      const result = await checkForUpdates({
        currentVersion: '2.4.3',
        fetchFn: mockFetch,
      });

      expect(result.updateAvailable).toBe(false);
      expect(result.currentVersion).toBe('2.4.3');
      expect(result.latestVersion).toBe('2.4.3');
      expect(result.error).toBe('Network error');
    });
  });
});
