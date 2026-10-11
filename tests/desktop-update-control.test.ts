import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  IDLE_UPDATE_STATUS,
  normalizeUpdateStatus,
} from '../src/app/components/ui/DesktopUpdateControl';

// The webview no longer drives its own `check()`: the desktop host owns the
// update flow and publishes status, because the Rust side used to prompt with a
// native dialog while this component ran a second, independent check. These
// tests pin the boundary — the UI renders what the host reports and nothing
// more.

describe('update copy style', () => {
  it('uses no em dashes or en dashes', () => {
    // BOZ's own style rule, enforced on the chat answers, has to hold for the
    // app's own voice too: commas and periods, never a stacked dash.
    const source = readFileSync(
      'src/app/components/ui/DesktopUpdateControl.tsx',
      'utf8',
    );
    // Strip comments so prose about the rule is not mistaken for the copy.
    const copy = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const dash of ['—', '–']) {
      expect(copy, `update copy contains a ${dash}`).not.toContain(dash);
    }
  });

  it('keeps the boot stage copy dash-free too', () => {
    const host = readFileSync('src-tauri/src/lib.rs', 'utf8');
    const stages = host.match(/stage: "[^"]*"/g) ?? [];
    expect(stages.length).toBeGreaterThan(0);
    for (const stage of stages) {
      expect(stage, `boot stage contains a dash: ${stage}`).not.toMatch(/[—–]/);
    }
  });
});

describe('normalizeUpdateStatus', () => {
  it('passes a well-formed host payload through', () => {
    expect(
      normalizeUpdateStatus({
        phase: 'downloading',
        version: '2.9.0',
        percent: 42,
        message: null,
        snoozedVersion: null,
      }),
    ).toEqual({
      phase: 'downloading',
      version: '2.9.0',
      percent: 42,
      message: null,
      snoozedVersion: null,
    });
  });

  it('falls back to idle for a missing or malformed payload', () => {
    for (const raw of [null, undefined, 'nope', 42, {}, { phase: 'sideways' }]) {
      expect(normalizeUpdateStatus(raw), String(raw)).toEqual(IDLE_UPDATE_STATUS);
    }
  });

  it('rejects an unknown phase rather than rendering it', () => {
    // An unrecognised phase must never look like "an update is ready".
    expect(normalizeUpdateStatus({ phase: 'installing-ish' }).phase).toBe('idle');
    expect(normalizeUpdateStatus({ phase: 'AVAILABLE' }).phase).toBe('idle');
  });

  it('clamps and rounds a percentage from the host', () => {
    expect(normalizeUpdateStatus({ phase: 'downloading', percent: 101 }).percent).toBe(100);
    expect(normalizeUpdateStatus({ phase: 'downloading', percent: -5 }).percent).toBe(0);
    expect(normalizeUpdateStatus({ phase: 'downloading', percent: 42.6 }).percent).toBe(43);
  });

  it('keeps an unknown download size as no percentage, never a fake one', () => {
    // The host reports null when the total size is unavailable. Inventing a
    // number there is the same class of bug as inventing a price level.
    expect(normalizeUpdateStatus({ phase: 'downloading', percent: null }).percent).toBeNull();
    expect(normalizeUpdateStatus({ phase: 'downloading' }).percent).toBeNull();
  });

  it('normalizes empty strings to null so the UI cannot render a blank version', () => {
    const status = normalizeUpdateStatus({
      phase: 'available',
      version: '',
      message: '',
      snoozedVersion: '',
    });
    expect(status.version).toBeNull();
    expect(status.message).toBeNull();
    expect(status.snoozedVersion).toBeNull();
  });

  it('keeps a snoozed version so the UI can explain why it is staying quiet', () => {
    expect(normalizeUpdateStatus({ phase: 'idle', snoozedVersion: '2.9.0' }).snoozedVersion)
      .toBe('2.9.0');
  });
});