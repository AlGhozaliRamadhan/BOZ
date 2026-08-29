import { describe, expect, it } from 'vitest';
import { resolveMode } from '../src/cli/mode';

describe('resolveMode', () => {
  it('launches the web dashboard by default', () => {
    expect(resolveMode([])).toEqual({ mode: 'web', port: 21526 });
  });

  it('keeps "web" as an explicit alias', () => {
    expect(resolveMode(['web'])).toEqual({ mode: 'web', port: 21526 });
  });

  it('honors BOZ_PORT', () => {
    expect(resolveMode([], { BOZ_PORT: '9999' })).toEqual({ mode: 'web', port: 9999 });
  });

  it('honors --port with or without the web alias', () => {
    expect(resolveMode(['--port', '4000'])).toEqual({ mode: 'web', port: 4000 });
    expect(resolveMode(['web', '--port', '4001'])).toEqual({ mode: 'web', port: 4001 });
  });

  it('falls back when a port is invalid', () => {
    expect(resolveMode(['--port', 'abc'])).toEqual({ mode: 'web', port: 21526 });
    expect(resolveMode(['--port', '70000'])).toEqual({ mode: 'web', port: 21526 });
  });

  it('returns version or help for non-launch commands', () => {
    expect(resolveMode(['--version'])).toEqual({ mode: 'version' });
    expect(resolveMode(['-v'])).toEqual({ mode: 'version' });
    expect(resolveMode(['--help'])).toEqual({ mode: 'help' });
    expect(resolveMode(['-h'])).toEqual({ mode: 'help' });
    expect(resolveMode(['terminal'])).toEqual({ mode: 'help' });
  });
});
