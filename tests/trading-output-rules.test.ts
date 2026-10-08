import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getReasoningPassPrompt } from '../src/shared/thought-prompts.js';
import { RUNTIME_SYSTEM_PROMPT } from '../src/shared/runtime-prompt.js';

// Config-level acceptance tests for the template-persistence / disclaimer-
// loophole / verification-theater fix. These assert on the configuration that
// shapes model output (skills, system prompts, engine prompts), not on live
// model text: a banned header cannot appear in output if no configuration
// mandates or emits it, and an untraceable number cannot be excused if no
// configuration permits the excuse.

function readRepo(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');
}

const BANNED_SKELETON = [
  'Initial Quantitative Synthesis',
  'Number verification',
  'Market read:',
  'Decisive evidence:',
  'Risk & invalidation:',
  'Execution rationale:',
];

// Task C delivery ban: these timeline labels must never be emitted as
// headers/sections. They may appear ONLY inside an explicit "Never emit"
// ban sentence (which is what forbids them), never as a mandate or label.
const BANNED_TIMELINE_LABELS = [
  'Research brief',
  'Quant recheck',
  'Number verification',
  'Initial Quantitative Synthesis',
];

/** A line mentioning a banned phrase is allowed only when it bans it. */
function isBanLine(line: string): boolean {
  return /never emit|never\b.*as headers|do not create|forbidden|one-render|internal-only/i.test(line);
}

function mandatesBannedHeader(body: string, banned: string): string[] {
  return body
    .split('\n')
    .filter((line) => line.includes(banned) && !isBanLine(line));
}

const PROMPT_SURFACES = [
  'src/shared/thought-prompts.ts',
  'src/shared/runtime-prompt.ts',
  '.boz/skills/intraday/SKILL.md',
  'src/shared/prompts.ts',
  'src/services/ai/ai.service.ts',
  'src/app/api/chat/route.ts',
];

describe('no fixed skeleton in configuration (Task A)', () => {
  for (const file of PROMPT_SURFACES) {
    it(`mandates none of the banned headers: ${file}`, () => {
      const body = readRepo(file);
      for (const banned of BANNED_SKELETON) {
        // Ban-list sentences ("Never emit X") name the phrase to forbid it —
        // that is allowed. A mandate or emitted label is not.
        expect(mandatesBannedHeader(body, banned), `${file} mandates banned skeleton "${banned}"`).toHaveLength(0);
      }
      for (const label of BANNED_TIMELINE_LABELS) {
        expect(mandatesBannedHeader(body, label), `${file} emits banned timeline label "${label}"`).toHaveLength(0);
      }
    });
  }

  it('emits no banned timeline label from the chat engine', () => {
    const engine = readRepo('src/app/api/chat/chat.engine.ts');
    for (const label of BANNED_TIMELINE_LABELS) {
      expect(mandatesBannedHeader(engine, label), `engine emits banned label "${label}"`).toHaveLength(0);
    }
    // "Branching off" survives ONLY as deletion code for model habit
    // (a strip regex), never as a prompt mandate.
    const hits = engine.split('\n').filter((line) => line.includes('Branching off'));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatch(/\.replace\(/);
    const thoughtPrompts = readRepo('src/shared/thought-prompts.ts');
    expect(thoughtPrompts).not.toContain('Branching off');
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).not.toContain('Branching off');
  });
});

describe('hardened number rule installed (Task B)', () => {
  it('intraday skill bans exemption words with no third path', () => {
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).toContain('create NO exemption');
    expect(skill).toContain('NO third path');
    expect(skill).toContain('levels not validated');
    expect(skill).toContain('risk_calc');
    expect(skill).toContain('150');
  });

  it('the clarified rule exempts risk_calc inputs: choosing levels is judgment', () => {
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).toContain('never to tool inputs');
    expect(skill).toContain('choosing them is required judgment');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('never to tool inputs');
    const prompt = getReasoningPassPrompt('High');
    expect(prompt).toContain('never to tool inputs');
  });

  it('system prompt carries the hardened contracts', () => {
    expect(RUNTIME_SYSTEM_PROMPT).toContain('create NO exemption');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('no third path');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('levels not validated');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('silent');
  });

  it('reasoning pass prompt installs two-phase output and silent verification', () => {
    const prompt = getReasoningPassPrompt('High');
    expect(prompt).toContain('Phase 1');
    expect(prompt).toContain('Phase 2');
    expect(prompt).toContain('risk_calc');
    expect(prompt).toContain('levels not validated');
    expect(prompt).toContain('NO third path');
  });
});

describe('disclaimer loophole closed (Task B)', () => {
  const loopholePermissions = [
    'ILLUSTRATIVE',
    'labelled DERIVED',
    'labeled DERIVED',
    'illustrative ranges',
    'conditional trigger table',
  ];

  for (const file of PROMPT_SURFACES) {
    it(`permits no disclaimer-labelled numbers: ${file}`, () => {
      const body = readRepo(file);
      for (const permission of loopholePermissions) {
        expect(body, `${file} permits loophole "${permission}"`).not.toContain(permission);
      }
    });
  }

  it('chat engine review passes delete untraceable numbers instead of relabelling', () => {
    const engine = readRepo('src/app/api/chat/chat.engine.ts');
    expect(engine).not.toContain('ILLUSTRATIVE');
    expect(engine).not.toContain('TOOL-VERIFIED');
    expect(engine).toContain('create NO exemption');
  });

  it('scenario-first shape: likely-path table + My take always present, no-trade banned', () => {
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).toContain('Likely-path table');
    expect(skill).toContain('My take');
    expect(skill).toContain('I would wait');
    expect(skill).toContain('Never emit "no trade"');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('likely-path table');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('My take');
    expect(RUNTIME_SYSTEM_PROMPT).not.toContain('conditional trigger table');
    const prompt = getReasoningPassPrompt('High');
    expect(prompt).toContain('likely-path table');
    expect(prompt).toContain('My take');
    expect(prompt).toContain('Never emit "no trade"');
    // Real-table shape with separated plan columns (Entry/Stop/TP1/TP2 never
    // crammed into one cell), taught identically everywhere the table is specified.
    for (const [name, body] of [['skill', skill], ['system', RUNTIME_SYSTEM_PROMPT], ['reasoning-pass', prompt]] as const) {
      expect(body, `${name} requires separated TP2 (runner) column`).toContain('TP2 (runner)');
      expect(body, `${name} requires a delimiter row`).toContain('|---|---|');
    }
    expect(skill).toContain('Never cram the whole plan into one cell');
    const engine = readRepo('src/app/api/chat/chat.engine.ts');
    for (const [name, body] of [['skill', skill], ['system', RUNTIME_SYSTEM_PROMPT], ['reasoning-pass', prompt], ['engine', engine]] as const) {
      expect(body, `${name} requires a natural opener`).toContain('in your own words');
      expect(body, `${name} bans the label-first stamp`).toContain('label-first stamp');
    }
  });
});
