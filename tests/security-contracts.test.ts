import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkloadGate } from '../src/services/security/workload-gate';

describe('security-sensitive repository contracts', () => {
  it('binds direct Next scripts to loopback', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect(pkg.scripts['dev:web']).toContain('--hostname 127.0.0.1');
    expect(pkg.scripts.start).toContain('--hostname 127.0.0.1');
  });

  it('triggers on GitHub release publication and enforces version guard', () => {
    const workflow = readFileSync(resolve('.github/workflows/publish.yml'), 'utf8');
    expect(workflow).toContain('release:');
    expect(workflow).toContain('types: [published]');
    expect(workflow).toContain('[ "$LOCAL_VERSION" != "$REMOTE_VERSION" ]');
  });

  it('keeps model selection request-local and removes autonomous memory writes', () => {
    const engine = readFileSync(resolve('src/app/api/chat/chat.engine.ts'), 'utf8');
    expect(engine).not.toContain('config.setAIModel(modelOverride)');
    expect(engine).not.toContain("name: 'update_memory'");
    expect(engine).toContain('untrusted_tool_output');
  });

  it('enforces process-wide admission limits', () => {
    const gate = new WorkloadGate(1);
    const release = gate.tryAcquire();
    expect(release).toBeTypeOf('function');
    expect(gate.tryAcquire()).toBeNull();
    release?.();
    expect(gate.tryAcquire()).toBeTypeOf('function');
  });

  it('caps the IDX universe before quote and chart work', () => {
    const universe = readFileSync(resolve('src/services/market/idx.universe.service.ts'), 'utf8');
    expect(universe).toContain('MAX_IDX_UNIVERSE_SIZE = 1_200');
    expect(universe).toContain('.slice(0, MAX_IDX_UNIVERSE_SIZE)');
  });
});
