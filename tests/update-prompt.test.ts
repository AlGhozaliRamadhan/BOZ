import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { claimStartupPrompt } from '../src/app/components/ui/use-host-update';

// The startup prompt is the one part of the update flow with the strictest
// opening rule: at most once per browser session, and never from a broken
// webview storage. `claimStartupPrompt` is that rule in one pure function.

const KEY = 'boz_update_prompted_session';

/** Minimal stand-in for window.sessionStorage. */
type MemoryEntries = Record<string, string>;
function memoryStorage(entries: MemoryEntries = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const store: MemoryEntries = { ...entries };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = value; },
  };
}

describe('claimStartupPrompt', () => {
  it('claims a fresh session exactly once', () => {
    const storage = memoryStorage();
    expect(claimStartupPrompt(storage, KEY)).toBe(true);
    // The very same session must not prompt again, however many events land.
    expect(claimStartupPrompt(storage, KEY)).toBe(false);
    expect(claimStartupPrompt(storage, KEY)).toBe(false);
  });

  it('never re-claims a session that was already prompted', () => {
    const storage = memoryStorage({ [KEY]: 'true' });
    expect(claimStartupPrompt(storage, KEY)).toBe(false);
  });

  it('reads the marker strictly, so any other value still claims', () => {
    const storage = memoryStorage({ [KEY]: 'false' });
    expect(claimStartupPrompt(storage, KEY)).toBe(true);
  });

  it('marks the slot when it claims', () => {
    const storage = memoryStorage();
    claimStartupPrompt(storage, KEY);
    expect(storage.getItem(KEY)).toBe('true');
  });

  it('throws on a failing write so callers can fall back to not prompting', () => {
    // Storage failure maps to "already prompted": the popup never appears
    // without an explicit event, and a broken write must not silently
    // un-claim for the caller.
    const broken: Pick<Storage, 'getItem' | 'setItem'> = {
      getItem: () => null,
      setItem: () => { throw new Error('quota exceeded'); },
    };
    expect(() => claimStartupPrompt(broken, KEY)).toThrow('quota exceeded');
  });
});

describe('sidebar update wiring (source inspection)', () => {
  const sidebar = readFileSync('src/app/components/layout/Sidebar.tsx', 'utf8');

  it('opens the real prompt modal, not the About modal', () => {
    // The startup popup used to be the About modal; the prompt now has its
    // own component and its own state.
    expect(sidebar).toContain('<UpdatePromptModal');
    expect(sidebar).toContain('setIsUpdatePromptOpen(true)');
  });

  it('gates the startup prompt through the shared helper', () => {
    expect(sidebar).toContain('claimStartupPrompt');
  });

  it('clears the host open request after surfacing the prompt', () => {
    // Left uncleared, the flag would drag the prompt open again on the next
    // status publish.
    expect(sidebar).toContain("'clear_update_open_request'");
  });
});
