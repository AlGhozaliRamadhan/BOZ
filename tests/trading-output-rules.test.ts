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
  });

  it('the clarified rule exempts risk_calc inputs: choosing levels is judgment', () => {
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).toContain('never to tool inputs');
    expect(skill).toContain('choosing them is required judgment');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('never to tool inputs');
    // Same exemption, stated once in the pass prompt: the number rule governs
    // what reaches the ANSWER, so picking the levels you hand to risk_calc is
    // the judgment the tool exists to check, not a violation of anything.
    const prompt = getReasoningPassPrompt('High');
    expect(prompt).toContain('Choosing the candidate levels you hand TO risk_calc is your judgment');
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
    // Two phases, a plan tested through risk_calc, and the wait path described
    // rather than forbidden. The levels-not-validated caveat is stated once in
    // the runtime contract and demonstrated by the worked example; repeating it
    // here is what the model quoted back at the user while thinking.
    expect(prompt).toContain('A plan gets its table');
    expect(prompt).toContain('Name the levels unvalidated once');
    expect(prompt).toMatch(/leave no trace of the fixing/i);
  });

  it('reasoning pass prompt makes the question set the depth, not a template', () => {
    // The reported failure: "what you think about those idx that keep going
    // down" came back as a 554-word brief with a scan inventory and a
    // manufactured short plan. A prompt that maps question shapes onto
    // structures would only relocate that; this pins the principle instead.
    const prompt = getReasoningPassPrompt('High');
    expect(prompt).toContain('The question sets the depth');
    expect(prompt).toMatch(/work out what would actually resolve what was asked/i);
    expect(prompt).toContain('rather than thoroughness');
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
    // The pass prompt no longer re-teaches the table: that shape is stated in the
    // runtime contract, demonstrated by the worked example, and enforced by
    // `answerCheck` on regen. What it owes the answer is the reasoning that
    // produces it — a path for each scenario, and the reader's own read.
    expect(prompt).toContain('A plan gets its table');
    expect(prompt).toContain('Close with your own read in one line, first person');
    expect(prompt).toContain('then what you are watching next');
    // A bare refusal is a market failure whatever the phrasing, so the reason
    // still has to be named — as the one way to get it wrong.
    expect(prompt).toContain('Handing the reader a rejection instead of a path is the one way');
    // Real-table shape with separated plan columns (Entry/Stop/TP1/TP2 never
    // crammed into one cell), taught where the analyst reads it.
    for (const [name, body] of [['skill', skill], ['system', RUNTIME_SYSTEM_PROMPT]] as const) {
      expect(body, `${name} requires separated TP2 (runner) column`).toContain('TP2 (runner)');
      expect(body, `${name} requires a delimiter row`).toContain('|---|---|');
    }
    expect(skill).toContain('Never cram the whole plan into one cell');
    const engine = readRepo('src/app/api/chat/chat.engine.ts');
    for (const [name, body] of [['skill', skill], ['system', RUNTIME_SYSTEM_PROMPT], ['reasoning-pass', prompt], ['engine', engine]] as const) {
      expect(body, `${name} requires a natural opener`).toContain('in your own words');
    }
    // The label-first stamp is banned in the surfaces that state the shape.
    for (const [name, body] of [['skill', skill], ['system', RUNTIME_SYSTEM_PROMPT], ['engine', engine]] as const) {
      expect(body, `${name} bans the label-first stamp`).toContain('label-first stamp');
    }
    expect(prompt).toContain('a sentence rather than a stamp');
  });
});
