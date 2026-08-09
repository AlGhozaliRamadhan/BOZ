import { describe, it, expect } from 'vitest';
import { resolveMode } from '../src/cli/mode';

describe('resolveMode', () => {
  it('returns pick for no args', () => {
    expect(resolveMode([])).toEqual({ mode: 'pick' });
  });

  it('returns terminal for "terminal"', () => {
    expect(resolveMode(['terminal'])).toEqual({ mode: 'terminal' });
  });

  it('returns web with default port for "web"', () => {
    expect(resolveMode(['web'])).toEqual({ mode: 'web', port: 21526 });
  });

  it('honors BOZ_PORT env', () => {
    expect(resolveMode(['web'], { BOZ_PORT: '9999' })).toEqual({ mode: 'web', port: 9999 });
  });

  it('honors --port flag over env', () => {
    expect(resolveMode(['web', '--port', '4000'], { BOZ_PORT: '9999' })).toEqual({ mode: 'web', port: 4000 });
  });

  it('rejects a non-numeric port', () => {
    expect(resolveMode(['web', '--port', 'abc'])).toEqual({ mode: 'web', port: 21526 });
  });

  it('returns version/help', () => {
    expect(resolveMode(['--version'])).toEqual({ mode: 'version' });
    expect(resolveMode(['-v'])).toEqual({ mode: 'version' });
    expect(resolveMode(['--help'])).toEqual({ mode: 'help' });
    expect(resolveMode(['-h'])).toEqual({ mode: 'help' });
  });
});
