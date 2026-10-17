import { describe, expect, it } from 'vitest';
import {
  THOUGHT_PROMPTS,
  getReasoningPassPrompt,
  getThoughtPrompt,
  type ThoughtEffort,
} from '../src/shared/thought-prompts.js';

describe('analysis prompts', () => {
  it('asks for the thinking to be visible, in one place, on every tier', () => {
    // POLICY REVERSAL. This used to assert the opposite — that BOZ never asks
    // for tagged reasoning and always tells the model to hide it. That policy is
    // why the panel had nothing real in it: `buildAiRead` filled it with BOZ's
    // own canned sentences. The user asked for the model's actual thinking, so
    // the prompt now asks for it and the engine shows it.
    const efforts: ThoughtEffort[] = ['Low', 'Medium', 'High', 'Extra', 'Max'];
    for (const effort of efforts) {
      expect(THOUGHT_PROMPTS[effort]).toContain('<thinking>');
      expect(THOUGHT_PROMPTS[effort]).toContain('native thinking or reasoning mode');
      // Stated once, identically, so a tier block cannot drift into a
      // contradicting instruction.
      expect(THOUGHT_PROMPTS[effort]).toContain('HOW TO THINK');
      expect(THOUGHT_PROMPTS[effort]).toContain('user-facing answer');
      // Never both ways: the old "do not reveal" line must be gone.
      expect(THOUGHT_PROMPTS[effort]).not.toContain('Do not reveal private reasoning');
    }
  });

  it('leads the reasoning instead of prescribing it', () => {
    // The prompt used to be a rulebook and the panel showed it: the model
    // recited contracts, word budgets and banned rows while thinking. These are
    // the properties that make it guidance rather than instruction.
    const prompt = getReasoningPassPrompt('High');

    // Two phases, real working, and the block is about the problem.
    expect(prompt).toContain('Two phases');
    expect(prompt).toContain('Phase 1');
    expect(prompt).toContain('Phase 2');
    expect(prompt).toContain('do the work where it can be seen');
    expect(prompt).toContain('never a recital of these instructions');

    // The destination, not the procedure: shape follows the finding.
    expect(prompt).toContain('Reach the call before you reach for a shape');
    expect(prompt).toContain('should not read alike');

    // Enforcement is named as something that happens to the model, not
    // something it must perform.
    expect(prompt).toContain('The shape is checked after you answer');

    // It leads with market work and closes pointing at the market.
    expect(prompt).toContain('risk_calc');
    expect(prompt.trimEnd().endsWith('Spend your words on the market.')).toBe(true);
  });

  it('keeps the rules no code can check, and drops the ones it can', () => {
    const prompt = getReasoningPassPrompt('Max');

    // INTEGRITY — no gate can verify these, so they must survive the rewrite.
    expect(prompt).toContain('Numbers come from a tool or they do not go in');
    expect(prompt).toContain('a number you cannot source');
    expect(prompt).toContain('Choosing the candidate levels you hand TO risk_calc is your judgment');
    expect(prompt).toContain('State missing data as missing');
    expect(prompt).toContain('never invent a probability');
    expect(prompt).toContain('Name the strongest fact against your own thesis');
    // Disclaimer words must be named as non-exemptions, not merely absent.
    expect(prompt).toMatch(/roughly.*approximately.*estimated/s);
    // Plan testing survives; the mandate to invent a second plan does not.
    expect(prompt).toContain("dashboard's own suggested plan");
    expect(prompt).not.toMatch(/build the obvious alternative/);
    expect(prompt).toMatch(/inventing a second plan to test after rejecting the first is not thoroughness/);
    // The question sets the depth — a principle, not a table of question shapes.
    expect(prompt).toContain('The question sets the depth');
    // Silent verification: the work is visible, the report is not.
    expect(prompt).toContain('Verify inside the thinking block');
    expect(prompt).toMatch(/leave no trace of the fixing/i);
    // A wait still gets a path rather than a refusal.
    expect(prompt).toContain('A plan gets its table');

    // READABILITY. The answer came back as one 330-word wall with figures
    // stacked breath-to-breath, which is complete and unreadable. Nothing in
    // the prompt asked for that; nothing now stops it either.
    expect(prompt).toContain('Write for a person reading this on a phone');
    expect(prompt).toContain('Short sentences');
    expect(prompt).toMatch(/Break where the thought actually turns/);
    expect(prompt).toMatch(/Hang each number off the claim it supports/);
    expect(prompt).toContain('Dense and complete beats long');

    // FORMAT — enforced by `answerCheck` on regen, so it is not negotiated here.
    // The word cap, the dash quota, the banned-phrase list and the enforcement
    // vocabulary are the lines the model used to quote back at the user.
    for (const rigidity of [
      '350 words',
      '150-250',
      'em dash',
      'NO third path',
      'non-negotiable',
      'ALWAYS',
      'required flow',
      'complete output spec',
      'no exemptions',
      'Research brief',
      'Quant recheck',
      'Number verification',
      'Initial Quantitative Synthesis',
    ]) {
      expect(prompt, `pass prompt still carries rigidity: ${rigidity}`).not.toContain(rigidity);
    }
    // The enumerated skeleton is the thing that made every day look alike.
    expect(prompt).not.toMatch(/Produce ONE answer containing/);
    // No instructional meta-sections telling the model to vary itself.
    expect(prompt).not.toContain('FRESH WORDS EVERY RUN');
    expect(prompt).not.toContain('NO REPETITION, COMPLETE OUTPUT');
  });

  it('never mandates a label or header, on any tier', () => {
    const prompt = getReasoningPassPrompt('Max');
    const bannedLabels = [
      'Number verification',
      'Initial Quantitative Synthesis',
      'Research brief',
      'Quant recheck',
    ];
    for (const label of bannedLabels) {
      expect(prompt).not.toContain(label);
    }
    expect(prompt).not.toContain('<analysis_note>');
    expect(prompt).not.toContain('Market read:');
    expect(prompt).not.toContain('Decisive evidence:');
    expect(prompt).not.toContain('Execution rationale:');
    expect(prompt).not.toContain('ILLUSTRATIVE');
    expect(prompt).not.toContain('conditional trigger table');
    // The delta rule is gone and no substitute vocabulary replaced it.
    expect(prompt).not.toContain('delta');
    expect(prompt).not.toContain('Breadth');
    // A bare refusal is a market failure, so the reason still has to be named —
    // stated as guidance rather than as a banned phrase.
    expect(prompt).toContain('Handing the reader a rejection instead of a path is the one way');
  });

  it('bans the model from reciting its own instructions in the visible block', () => {
    // The panel showed "The contract: If risk_calc is unavailable or errors…"
    // for the word "hi": the model audited BOZ's delivery rules inside the
    // thinking block the user reads. That is a prompt defect, not a UI one.
    const efforts: ThoughtEffort[] = ['Low', 'Medium', 'High', 'Extra', 'Max'];
    for (const effort of efforts) {
      const prompt = THOUGHT_PROMPTS[effort];
      expect(prompt).toContain('Keep it about the problem');
      expect(prompt).toContain('not the place to restate these');
      expect(prompt).toMatch(/Scale it to the message/);
      // A checklist for a one-line message is the failure this replaced.
      expect(prompt).toMatch(/a sentence or two, not an audit/);
      // And the thinking moves forward instead of re-opening what the reader
      // already watched: the panel was three paragraphs of the same question
      // restated around each tool call.
      expect(prompt).toContain('Move forward as you go');
      expect(prompt).toContain('start from what just changed');
      expect(prompt).toMatch(/asking again what you decided to do/);
      // It must not narrate its own composition. The panel filled with
      // "Word cap 350. Let's write." and "Let me re-run risk_calc with the
      // data-native stop" — the model describing the writing instead of doing
      // the analysis, and repeating both because it kept re-entering the phase.
      expect(prompt).toContain('Think about the market, not about the writing');
      expect(prompt).toMatch(/Announcing your own word budget/);
      expect(prompt).toMatch(/let me re-run X/);
      expect(prompt).toContain('A number you already have is a number you stop asking for');
    }
  });

  it('gives a greeting its own thinking directive instead of the analysis tiers', () => {
    const greeting = getThoughtPrompt('Max', 'social');
    expect(greeting).toContain('<thinking>');
    expect(greeting).toContain('One or two sentences');
    // None of the analysis machinery leaks into a "hi".
    expect(greeting).not.toContain('risk_calc');
    expect(greeting).not.toContain('likely-path table');
    expect(greeting).toContain('no restatement of these instructions');
    // A follow-up question about the previous answer still gets the full tiers.
    expect(getThoughtPrompt('Max', 'question')).toBe(THOUGHT_PROMPTS.Max);
    expect(getThoughtPrompt('Max')).toBe(THOUGHT_PROMPTS.Max);
  });

  it('answers a greeting under a two-phase prompt instead of the delivery contract', () => {
    // This is the transcript the user reported for "hi": the pass prompt is a
    // delivery contract, and a model reasoning under it weighs the likely-path
    // table against the rule banning an all-dash row — in the visible block.
    const greeting = getReasoningPassPrompt('Max', 'social');
    expect(greeting).toContain('CONVERSATIONAL ANSWER PASS');
    expect(greeting).not.toContain('risk_calc');
    expect(greeting).not.toContain('levels not validated');
    expect(greeting).toContain('Keep it about them');
    expect(greeting).toContain('a short warm reply is a complete answer');
    // It describes the reply instead of listing what is forbidden: a ban list
    // here is what the model quoted back ("no likely-path table, no plan").
    expect(greeting).not.toContain('Nothing else is required');
    expect(greeting).not.toContain('no source list');
    // A follow-up question relaxes the same way.
    expect(getReasoningPassPrompt('High', 'question')).toBe(greeting);
    expect(getReasoningPassPrompt('High')).toBe(getReasoningPassPrompt('High'));
  });
});