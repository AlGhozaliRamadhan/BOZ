import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { executeRiskCalc } from '../src/tools/risk.tool.js';
import { answerCheck, type AnswerCheckToolCall } from '../src/shared/answer-check.js';

function readRepo(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');
}

const PROMPT_SURFACES = [
  '.boz/skills/intraday/SKILL.md',
  'src/shared/runtime-prompt.ts',
  'src/shared/thought-prompts.ts',
  'src/app/api/chat/chat.engine.ts',
  'src/app/api/chat/route.ts',
  'src/services/ai/ai.service.ts',
  'src/shared/evidence-attribution.ts',
  'src/shared/answer-check.ts',
];

async function nvdaToolLog(): Promise<{ log: AnswerCheckToolCall[]; failing: string; passing: string }> {
  const failing = await executeRiskCalc({
    symbol: 'NVDA', side: 'long', entry: 237.47, stop: 188.96, targets: [245.33], atr: 5.61,
  });
  const passing = await executeRiskCalc({
    symbol: 'NVDA', side: 'long', entry: 226.5, stop: 218.94, targets: [243.37, 248], atr: 5.61,
  });
  const web = JSON.stringify({
    tool: 'web_search',
    results: [{ title: 'NVDA chips', url: 'https://www.cnbc.com/2026/10/07/nvda-chips.html' }],
  });
  const toEntry = (tool: string, text: string): AnswerCheckToolCall => {
    const parsed = JSON.parse(text) as any;
    return {
      tool,
      input: { entry: parsed.entry, stop: parsed.stop, targets: parsed.targets },
      output: { warnings: parsed.warnings },
      text,
    };
  };
  return {
    log: [toEntry('risk_calc', failing), toEntry('risk_calc', passing), { tool: 'web_search', input: {}, output: {}, text: web }],
    failing,
    passing,
  };
}

describe('Task A — risk_calc patch: echo inputs, round floats', () => {
  it('verification call echoes inputs and rounds (stop_distance 48.51, entry/stop present)', async () => {
    const obs = await executeRiskCalc({
      symbol: 'NVDA', side: 'long', entry: 237.47, stop: 188.96, targets: [245.33], atr: 5.61,
    });
    const parsed = JSON.parse(obs);
    expect(parsed.symbol).toBe('NVDA');
    expect(parsed.side).toBe('long');
    expect(parsed.entry).toBe(237.47);
    expect(parsed.stop).toBe(188.96);
    expect(parsed.targets).toEqual([245.33]);
    expect(parsed.atr).toBe(5.61);
    expect(parsed.stop_distance).toBe(48.51);
    expect(parsed.per_target[0].rr).toBe(0.16);
    expect(obs).toContain('"stop_distance":48.51');
    expect(obs).not.toMatch(/\d\.9{3,}/);
  });

  it('passing call carries zero warnings with rounded R:R', async () => {
    const obs = await executeRiskCalc({
      symbol: 'NVDA', side: 'long', entry: 226.5, stop: 218.94, targets: [243.37, 248], atr: 5.61,
    });
    const parsed = JSON.parse(obs);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.per_target.map((p: { rr: number }) => p.rr)).toEqual([2.23, 2.84]);
    expect(obs).not.toMatch(/\d\.9{3,}/);
  });
});

describe('Task D1 — fixture: this run\'s bad answer must FAIL the gate', () => {
  // Reconstructed from the run description: denial sentence quoted verbatim,
  // raw pasted tool fragment with the observed 48.50999999999999 garbage,
  // invented "Coverage add-ons" macro claims, and an API endpoint URL that
  // appears in no tool output. If answerCheck passes this, the gate is wrong.
  const BAD_ANSWER = [
    'FLAT, low conviction — invalidates on a volume-backed hold above 243.37.',
    'The dashboard plan fails on contact: {"stop_distance": 48.50999999999999, "rr": 0.16202} for 7.86 reward.',
    'No alternative entry/stop/target combination has been validated through a passing risk_calc call,',
    'so I cannot recommend a position without such validation.',
    'Coverage add-ons: USD-denominated debt is modest for NVDA and passive flows into tech ETFs continue to provide tailwinds.',
    'Evidence & sources: https://api.marketdata.example.com/v1/quotes?symbol=NVDA.',
  ].join(' ');

  it('fails with suppression + deflection + raw-output + endpoint-URL issues', async () => {
    const { log } = await nvdaToolLog();
    const result = answerCheck(BAD_ANSWER, log);
    expect(result.pass).toBe(false);
    const joined = result.issues.join(' | ');
    expect(joined).toContain('zero-warning risk_calc call exists');
    expect(joined).toContain(`deflection signature: 'cannot recommend'`);
    expect(joined).toContain(`deflection signature: 'without such validation'`);
    expect(joined).toContain('raw tool output or unrounded float in answer');
    // api.* host is feed infrastructure: named inline, never pasted as a link.
    expect(joined).toContain('API/endpoint URL pasted as source');
  });

  it('the 9-run float branch fires on unrounded garbage', () => {
    const result = answerCheck('Plan R:R 2.9999999999999996 for 7.86 reward.', []);
    expect(result.pass).toBe(false);
    expect(result.issues.join(' | ')).toContain('raw tool output or unrounded float in answer');
  });
});

const GOOD_TABLE = '| Scenario | Trigger | Entry | Stop | TP1 | TP2 (runner) | R:R |\n'
  + '|---|---|---|---|---|---|---|\n'
  + '| Base: pullback holds, grind to resistance | 226.5 holds on expanding volume | 226.5 | 218.94 | 243.37 | 248 | 2.23 / 2.84 |\n'
  + '| Alt: doji top rejects, drift back | Lose 226.5 on light volume | — | — | — | — | — |\n';

describe('Task D2 — NVDA re-run: likely path presented, gate PASSES', () => {
  const GOOD_ANSWER = 'I\'m leaning long with moderate conviction, playing the pullback only, and it invalidates on a close below SMA-50 220.58. '
    + `Dashboard's own plan is dead on contact: 48.51 risk for 7.86 reward, R:R 0.16 (risk_calc). `
    + 'The pullback alternative passes risk_calc; levels in the table.\n\n'
    + GOOD_TABLE + '\n'
    + 'My take: I would wait for the dip to 226.5 rather than chase the doji at 237.47; fundamentals inconclusive.';

  it('answer contains the 226.5 / 218.94 / 243.37 / 248 plan', () => {
    for (const n of ['226.5', '218.94', '243.37', '248']) {
      expect(GOOD_ANSWER).toContain(n);
    }
  });

  it('answerCheck returns PASS on the re-run', async () => {
    const { log } = await nvdaToolLog();
    const result = answerCheck(GOOD_ANSWER, log);
    expect(result.issues, `gate issues: ${result.issues.join('; ')}`).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('waiting on the passing plan with numbers + likely path also passes (no banned phrasing)', async () => {
    const { log } = await nvdaToolLog();
    const decline = 'I\'m sitting this one out, low conviction — a volume-backed hold above 243.37 flips me long. '
      + 'I tested the pullback plan (entry 226.5, stop 218.94, TP1 243.37, TP2 248 — R:R 2.23/2.84, no warnings) '
      + 'but participation is 0.75x average and the entry never triggered.\n\n'
      + GOOD_TABLE + '\n'
      + 'My take: I see it moving linearly here, so I would stay light and watch 226.5 for the tell.';
    const result = answerCheck(decline, log);
    expect(result.issues, `gate issues: ${result.issues.join('; ')}`).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('a label-stamp opener fails the gate even with table + take present', async () => {
    const { log } = await nvdaToolLog();
    const stamped = 'WAIT, medium conviction, location is bad to chase strength into ceiling. '
      + '| Base: drift sideways | wait for 226.5 to print on expanding volume | I would work the dip there | '
      + '| Alt: volume-backed hold above 243.37 | flip to continuation | I would reassess long | '
      + 'My take: I would wait for 226.5.';
    const result = answerCheck(stamped, log);
    expect(result.pass).toBe(false);
    expect(result.issues.join(' | ')).toContain('label-stamp opener');
  });

  it('inline pipes without a delimiter row fail the real-table check', async () => {
    const { log } = await nvdaToolLog();
    const prose = 'I\'m leaning long with moderate conviction, and it invalidates on a close below SMA-50 220.58. '
      + '| Base: pullback holds | wait for 226.5 | Long 226.5, stop 218.94, targets 243.37 / 248, R:R 2.23, 2.84 | '
      + '| Alt: rejection | lose 226.5 | stand aside | '
      + 'My take: I would wait for the dip to 226.5.';
    const result = answerCheck(prose, log);
    expect(result.pass).toBe(false);
    expect(result.issues.join(' | ')).toContain('missing real likely-path table');
  });

  it('a table with the plan crammed into one cell fails the separated-columns check', async () => {
    const { log } = await nvdaToolLog();
    const crammed = 'I\'m leaning long with moderate conviction, and it invalidates on a close below SMA-50 220.58.\n\n'
      + '| Scenario | Trigger | Plan |\n'
      + '|---|---|---|\n'
      + '| Base: pullback holds | 226.5 holds | Long 226.5, stop 218.94, targets 243.37 / 248 |\n\n'
      + 'My take: I would wait for the dip to 226.5.';
    const result = answerCheck(crammed, log);
    expect(result.pass).toBe(false);
    expect(result.issues.join(' | ')).toContain('missing separated ENTRY column');
  });

  it('a bare no-trade refusal with no table fails the scenario gate', async () => {
    const { log } = await nvdaToolLog();
    const bare = 'FLAT, low conviction — invalidates above 243.37. No trade today, market is choppy.';
    const result = answerCheck(bare, log);
    expect(result.pass).toBe(false);
    expect(result.issues.join(' | ')).toContain('likely-path');
  });
});

describe('URL hygiene — markdown punctuation + endpoint sources', () => {
  it('does not flag a grounded URL wrapped in a markdown link (trailing paren)', async () => {
    const { log } = await nvdaToolLog();
    const answer = 'I\'m sitting this one out, low conviction — a volume-backed hold above 243.37 flips me long.\n\n'
      + GOOD_TABLE + '\n'
      + 'My take: I would wait for 226.5. According to [CNBC](https://www.cnbc.com/2026/10/07/nvda-chips.html), chips stay in focus.';
    const result = answerCheck(answer, log);
    expect(result.issues.join(' | ')).not.toContain('URL');
    expect(result.issues, `gate issues: ${result.issues.join('; ')}`).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it('flags API/endpoint URLs even when a tool output carried them', async () => {
    const { log } = await nvdaToolLog();
    const withEndpoint: AnswerCheckToolCall[] = [
      ...log,
      {
        tool: 'fetch_sentiment',
        input: {},
        output: {},
        text: 'Fear & Greed 45 from https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      },
    ];
    const answer = 'I\'m sitting this one out, low conviction — a volume-backed hold above 243.37 flips me long.\n\n'
      + GOOD_TABLE + '\n'
      + 'My take: I would wait for 226.5. Fear & Greed at 45 per [CNN Fear & Greed](https://production.dataviz.cnn.io/index/fearandgreed/graphdata).';
    const result = answerCheck(answer, withEndpoint);
    expect(result.pass).toBe(false);
    expect(result.issues.join(' | ')).toContain('API/endpoint URL pasted as source');
  });
});

describe('Task D3 — zero Coverage add-ons, zero 999s', () => {
  it('no "Coverage add-ons" section name in any config surface', () => {
    for (const file of PROMPT_SURFACES) {
      const body = readRepo(file);
      // Ban sentences name the phrase to forbid it — allowed. A mandate or
      // emitted section label is not.
      const offenders = body
        .split('\n')
        .filter((line) => line.includes('Coverage add-ons') && !/never invent|never emit|forbidden|banned|no "coverage/i.test(line));
      expect(offenders, `${file} emits a "Coverage add-ons" section`).toHaveLength(0);
    }
  });

  it('no unrounded 9-run floats in risk_calc outputs', async () => {
    const { failing, passing } = await nvdaToolLog();
    const trend = await executeRiskCalc({
      symbol: 'NVDA', side: 'long', entry: 240.0, stop: 234.0, targets: [249.0, 255.0], atr: 2.4,
    });
    for (const [name, obs] of [['failing', failing], ['passing', passing], ['trend', trend]] as const) {
      expect(obs, `${name} output has 9-run float`).not.toMatch(/\d\.9{3,}/);
    }
  });
});
