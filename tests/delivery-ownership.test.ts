import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { risk_calc } from '../src/shared/risk-math.js';
import { executeRiskCalc } from '../src/tools/risk.tool.js';
import { RUNTIME_SYSTEM_PROMPT } from '../src/shared/runtime-prompt.js';
import { getReasoningPassPrompt } from '../src/shared/thought-prompts.js';

function readRepo(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');
}

// Scenario-first anchor: failing dashboard plan tested, obvious alternative
// constructed and passed, likely-path table + first-person take included.
// Must appear verbatim in the skill.
const WORKED_EXAMPLE =
  'I\'m leaning long with moderate conviction, playing the pullback only, and it invalidates on a close below SMA-50 220.58. Dashboard\'s own plan is dead on contact: 48.51 risk for 7.86 reward, R:R 0.16 (risk_calc). The obvious alternative — pullback entry near SMA-20, stop below structure, TP1 at resistance, TP2 runner beyond it — passes risk_calc; levels in the table.\n\n| Scenario | Trigger | Entry | Stop | TP1 | TP2 (runner) | R:R |\n|---|---|---|---|---|---|---|\n| Base: pullback holds, grind to resistance | 226.50 holds on expanding volume | 226.50 | 218.94 | 243.37 | 248.00 | 2.23 / 2.84 |\n| Alt: doji top rejects, drift back to structure | Lose 226.50 on light volume | — | — | — | — | — |\n\nMy take: I would wait for the dip to 226.50 rather than chase the doji at 237.47; I see the path as pullback-first, then continuation if volume expands. Fundamentals inconclusive, headlines thin.';

const PROMPT_SURFACES = [
  '.boz/skills/intraday/SKILL.md',
  'src/shared/runtime-prompt.ts',
  'src/shared/thought-prompts.ts',
  'src/app/api/chat/chat.engine.ts',
  'src/app/api/chat/route.ts',
  'src/services/ai/ai.service.ts',
];

describe('Task C1 — NVDA regression: dashboard plan fails, alternative passes', () => {
  it('risk_calc fails the dashboard plan on contact (R:R 0.16)', async () => {
    const obs = await executeRiskCalc({
      symbol: 'NVDA',
      side: 'long',
      entry: 237.47,
      stop: 188.96,
      targets: [245.33],
      atr: 5.61,
    });
    const parsed = JSON.parse(obs);
    expect(parsed.stop_distance).toBeCloseTo(48.51, 2);
    expect(parsed.stop_atr_multiple).toBeCloseTo(8.65, 1);
    expect(parsed.per_target[0].rr).toBeCloseTo(0.16, 2);
    expect(parsed.warnings.join(' ')).toContain('RR below 1.5');
  });

  it('risk_calc passes the constructed alternative (R:R 2.23 / 2.84)', async () => {
    const obs = await executeRiskCalc({
      symbol: 'NVDA',
      side: 'long',
      entry: 226.5,
      stop: 218.94,
      targets: [243.37, 248.0],
      atr: 5.61,
    });
    const parsed = JSON.parse(obs);
    expect(parsed.stop_distance).toBeCloseTo(7.56, 2);
    expect(parsed.per_target[0].rr).toBeCloseTo(2.23, 2);
    expect(parsed.per_target[1].rr).toBeCloseTo(2.84, 2);
    expect(parsed.warnings.join(' ')).not.toContain('RR below 1.5');
  });

  it('skill + system prompt require testing the dashboard plan AND constructing an alternative', () => {
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).toContain('including the dashboard\'s own suggested plan');
    expect(skill).toContain('show the failing output');
    expect(skill).toContain('IMMEDIATELY construct the obvious alternative');
    expect(skill).toContain('Stopping after step 1 is a stall');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('including the dashboard\'s own suggested plan');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('IMMEDIATELY construct the obvious alternative');
    const prompt = getReasoningPassPrompt('Max');
    expect(prompt).toContain('IMMEDIATELY construct the obvious alternative');
  });

  it('worked example anchor is verbatim in the skill', () => {
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).toContain(WORKED_EXAMPLE);
  });

  it('worked-example numbers trace to tool values (no invented figures)', () => {
    const dashboard = risk_calc({ symbol: 'NVDA', side: 'long', entry: 237.47, stop: 188.96, targets: [245.33], atr: 5.61 });
    const alt = risk_calc({ symbol: 'NVDA', side: 'long', entry: 226.5, stop: 218.94, targets: [243.37, 248.0], atr: 5.61 });
    // risk_calc outputs echoed in the example
    expect(WORKED_EXAMPLE).toContain(dashboard.stop_distance!.toFixed(2)); // 48.51
    expect(WORKED_EXAMPLE).toContain(alt.per_target[0].rr!.toFixed(2)); // 2.23
    expect(WORKED_EXAMPLE).toContain(alt.per_target[1].rr!.toFixed(2)); // 2.84
    expect(WORKED_EXAMPLE).toContain(dashboard.per_target[0].rr!.toFixed(2)); // 0.16
    // One number, one appearance: the derived stop distance (7.56) is NOT
    // restated — entry/stop/TPs plus R:R carry the math without duplication.
    expect(WORKED_EXAMPLE).not.toContain('7.56');
    // risk_calc inputs (dashboard-native levels + structural choices) quoted back
    for (const level of ['226.50', '218.94', '243.37', '248.00', '237.47', '220.58']) {
      expect(WORKED_EXAMPLE).toContain(level);
    }
    expect(WORKED_EXAMPLE).toContain('risk_calc');
  });
});

describe('Task C2 — one render: no delta rule, no delta vocabulary, internal-only passes', () => {
  const banned = ['Research brief', 'Quant recheck', 'Number verification', 'Initial Quantitative Synthesis'];
  const surfaces = [
    '.boz/skills/intraday/SKILL.md',
    'src/shared/runtime-prompt.ts',
    'src/shared/thought-prompts.ts',
    'src/app/api/chat/chat.engine.ts',
    'src/app/api/chat/route.ts',
    'src/services/ai/ai.service.ts',
  ];
  for (const file of surfaces) {
    it(`never mandates or emits banned labels: ${file}`, () => {
      const body = readRepo(file);
      const offenders = body
        .split('\n')
        .filter((line) => banned.some((b) => line.includes(b)) && !/never emit|never\b.*as headers|do not create|forbidden|one-render|internal-only/i.test(line));
      expect(offenders, `${file} emits a banned timeline label`).toHaveLength(0);
    });
  }

  it('the delta rule is gone everywhere: no deltas-only contract, no delta headers', () => {
    for (const file of PROMPT_SURFACES) {
      const body = readRepo(file);
      expect(body, `${file} still carries the delta rule`).not.toContain('deltas ONLY');
      expect(body, `${file} still carries the delta rule`).not.toContain('emits deltas');
      expect(body, `${file} still carries the delta rule`).not.toContain('emit deltas');
      for (const label of ['Number delta', 'Logic delta', 'Breadth delta', 'Evidence delta']) {
        expect(body, `${file} still emits delta label "${label}"`).not.toContain(label);
      }
    }
  });

  it('no breadth vocabulary survives in prompt surfaces or review plumbing', () => {
    const specSurfaces = PROMPT_SURFACES.filter((f) => f !== 'src/app/api/chat/chat.engine.ts');
    for (const file of specSurfaces) {
      const body = readRepo(file);
      const hits = body.split('\n').filter((line) => /breadth/i.test(line));
      expect(hits, `${file} still mentions breadth: ${hits.join(' | ')}`).toHaveLength(0);
    }
    // Task A finding, locked in: the engine's only remaining "breadth" is the
    // IDX scanner's market-breadth DATA field (tool output), never a review
    // label. Anything else is a regression of the mystery-vocabulary failure.
    const engine = readRepo('src/app/api/chat/chat.engine.ts');
    const engineHits = engine.split('\n').filter((line) => /breadth/i.test(line));
    expect(engineHits.length).toBeGreaterThan(0);
    for (const hit of engineHits) {
      expect(
        /breadth signal|breadthMatch|\$\{breadth\}/.test(hit),
        `engine breadth outside IDX market-breadth plumbing: ${hit.trim()}`,
      ).toBe(true);
    }
  });

  it('engine review passes are internal-only: no timeline labels yielded', () => {
    const engine = readRepo('src/app/api/chat/chat.engine.ts');
    expect(engine).toContain('internal-only');
    expect(engine).not.toContain("thought = 'Number delta'");
    expect(engine).not.toContain("thought = 'Logic delta'");
    expect(engine).not.toContain("thought = 'Breadth delta'");
    expect(engine).not.toContain('BREADTH REVIEW');
    expect(engine).not.toContain('LOGIC REVIEW');
    expect(engine).not.toContain('NUMBER DELTA');
    expect(engine).not.toContain("parseAnalysisPassOutput(draft, 'Research brief')");
    expect(engine).not.toContain("thought = 'Quant recheck'");
  });

  it('reasoning pass installs the consolidated spec, not the delta rule', () => {
    const prompt = getReasoningPassPrompt('Max');
    expect(prompt).not.toContain('deltas ONLY');
    expect(prompt).not.toContain('delta');
    expect(prompt).toContain('ONE answer');
    expect(prompt).toContain('required flow');
    expect(prompt).toContain('clean');
  });
});

describe('Task C3 — delivery: cap, conclusion, sources', () => {
  it('350-word hard cap with conclusion-first is installed', () => {
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).toContain('350 words');
    expect(skill).toContain('never cut the conclusion');
    expect(skill).toContain('invalid if it does not contain the conclusion');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('350 words');
    const prompt = getReasoningPassPrompt('Max');
    expect(prompt).toContain('350 words');
  });

  it('sources are inline with URLs at most once at the end', () => {
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).toContain('per CNBC');
    expect(skill).toContain('at most once');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('per CNBC');
  });

  it('worked example ends with a complete sentence and fits the cap', () => {
    expect(WORKED_EXAMPLE.trim().endsWith('.')).toBe(true);
    expect(WORKED_EXAMPLE).toMatch(/^I'm leaning long/);
    expect(WORKED_EXAMPLE.split(/\s+/).length).toBeLessThanOrEqual(350);
  });
});

describe('Task C4 — ownership: zero deflection signatures', () => {
  it('engine contains no bureaucratic refusal', () => {
    const engine = readRepo('src/app/api/chat/chat.engine.ts');
    // Ban sentences name the phrase to forbid it — allowed. A functional
    // refusal ("no passing X exists" as engine behavior) is not.
    const offenders = engine
      .split('\n')
      .filter((line) => line.includes('no passing') && !/banned|forbidden|never/i.test(line));
    expect(offenders, `engine refusal: ${offenders.join(' | ')}`).toHaveLength(0);
    expect(engine).not.toContain('exists for these numbers');
    expect(engine).not.toContain('then validate_plan');
    // The old user-directed instruction is gone; ownership lives in prompts.
    expect(engine).not.toMatch(/What would change this: run risk_calc/);
  });

  it('no functional validate_plan mandate survives (ban-example only)', () => {
    const surfaces = [
      '.boz/skills/intraday/SKILL.md',
      'src/shared/runtime-prompt.ts',
      'src/shared/thought-prompts.ts',
      'src/app/api/chat/chat.engine.ts',
      'src/app/api/chat/route.ts',
      'src/services/ai/ai.service.ts',
      'src/tools/risk.tool.ts',
      'src/shared/risk-math.ts',
    ];
    for (const file of surfaces) {
      const body = readRepo(file);
      const hits = body.split('\n').filter((line) => line.includes('validate_plan'));
      for (const hit of hits) {
        // Allowed: the forbidden-example ban sentence, and test-facing ban lists.
        expect(
          /Forbidden|never emit|forbidden/i.test(hit),
          `${file} has a functional validate_plan reference: ${hit.trim()}`,
        ).toBe(true);
      }
    }
  });

  it('no prompt tells the user to run a tool', () => {
    const surfaces = [
      '.boz/skills/intraday/SKILL.md',
      'src/shared/runtime-prompt.ts',
      'src/shared/thought-prompts.ts',
      'src/app/api/chat/chat.engine.ts',
      'src/app/api/chat/route.ts',
      'src/services/ai/ai.service.ts',
    ];
    for (const file of surfaces) {
      const body = readRepo(file);
      const hits = body
        .split('\n')
        .filter((line) => /you (run|call|execute|invoke) (your|the|a) (tool|risk_calc)/i.test(line));
      expect(hits, `${file} tells the user to run a tool: ${hits.join(' | ')}`).toHaveLength(0);
    }
  });

  it('ownership rules are installed in skill + system prompt', () => {
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).toContain('market evidence is the reason');
    expect(skill).toContain('I did not run X because Y');
    expect(skill).toContain('Never tell the user to run your tools');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('market evidence is the reason');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('Never tell the user to run your tools');
  });
});

describe('Task C5 — trade day vs wait day look visibly different (table + take)', () => {
  it('skill + system prompt require visibly different shapes', () => {
    const skill = readRepo('.boz/skills/intraday/SKILL.md');
    expect(skill).toContain('visibly different');
    expect(RUNTIME_SYSTEM_PROMPT).toContain('visibly different');
    const prompt = getReasoningPassPrompt('Max');
    expect(prompt).toContain('risk_calc');
  });

  it('the consolidated anchor is a trade-day shape with table + take', () => {
    // Trade-day anchor carries a plan block with four risk_calc-verbatim numbers.
    for (const n of ['226.50', '218.94', '243.37', '248.00']) {
      expect(WORKED_EXAMPLE).toContain(n);
    }
    expect(WORKED_EXAMPLE).toContain('| R:R |');
    expect(WORKED_EXAMPLE).toContain('2.23 / 2.84');
    // And it still leads with a stance line carrying conviction + invalidation.
    expect(WORKED_EXAMPLE).toMatch(/conviction/);
    expect(WORKED_EXAMPLE).toMatch(/invalidates on/);
    // Scenario-first: table rows + first-person take are always present.
    expect(WORKED_EXAMPLE).toContain('| Base:');
    expect(WORKED_EXAMPLE).toContain('My take:');
    expect(WORKED_EXAMPLE).toContain('I would wait');
    expect(WORKED_EXAMPLE.toLowerCase()).not.toContain('no trade');
  });

  it('second scenario (clean trend day): decisive plan passes risk_calc cleanly', async () => {
    // Clean trend day with volume expansion: pullback holding above SMA-20,
    // stop below structure at 2.5x ATR, TP1 at measured resistance, TP2 runner.
    // Same spec, visibly different verdict from the conditional NVDA anchor.
    const obs = await executeRiskCalc({
      symbol: 'NVDA',
      side: 'long',
      entry: 240.0,
      stop: 234.0,
      targets: [249.0, 255.0],
      atr: 2.4,
    });
    const parsed = JSON.parse(obs);
    expect(parsed.stop_distance).toBeCloseTo(6.0, 6);
    expect(parsed.stop_atr_multiple).toBeCloseTo(2.5, 6);
    expect(parsed.per_target[0].rr).toBeCloseTo(1.5, 6);
    expect(parsed.per_target[1].rr).toBeCloseTo(2.5, 6);
    expect(parsed.warnings).toHaveLength(0);
    // Plan block present: targets, stop distance and R:R are quotable
    // verbatim from the passing tool output (entry/stop are the call inputs
    // the ledger records; the output confirms them via stop_distance + R:R).
    expect(parsed.per_target.map((p: { target: number }) => p.target)).toEqual([249, 255]);
    // Structure differs from the NVDA anchor: NVDA is conditional with a
    // wait trigger + likely-path table; the trend day earns a decisive stance.
    expect(WORKED_EXAMPLE).toMatch(/^I'm leaning/);
    expect(WORKED_EXAMPLE).toContain('My take:');
    expect(WORKED_EXAMPLE).toContain('wait for the dip');
  });

  it('validated trade numbers come verbatim from risk_calc', () => {
    const r = risk_calc({ symbol: 'NVDA', side: 'long', entry: 100, stop: 95, targets: [110], atr: 2 });
    expect(r.per_target[0].rr).toBeCloseTo(2.0, 6);
    expect(r.stop_distance).toBeCloseTo(5, 6);
  });
});
