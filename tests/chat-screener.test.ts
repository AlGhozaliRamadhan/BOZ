import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const engine = readFileSync(resolve('src/app/api/chat/chat.engine.ts'), 'utf8');

describe('chat screener awareness', () => {
  it('exposes a neutrally named multi-universe screener tool with conviction control', () => {
    expect(engine).toContain("name: 'stock_screener'");
    expect(engine).not.toContain("name: 'scan_indonesia_momentum'");
    expect(engine).not.toContain('scan_indonesia_momentum');
    expect(engine).toContain('universe');
    expect(engine).toContain('minimum_conviction');
    expect(engine).toContain("'idx', 'us', 'crypto', 'global'");
    expect(engine).toContain("enum: ['LOW', 'MEDIUM', 'HIGH']");
  });

  it('mirrors the Screeners page contract (same engine as GET /api/idx/scan)', () => {
    expect(engine).toContain('same engine behind the Screeners page');
    expect(engine).toContain('GET /api/idx/scan');
    expect(engine).toContain('all_time_low');
    expect(engine).toContain('alias of near_52w_low');
  });

  it('passes universe and conviction through to the scanner service', () => {
    expect(engine).toContain('minimumConviction');
    expect(engine).toContain('universe: universe as any');
  });

  it('treats the screener as the primary tool and asks for the market instead of defaulting', () => {
    expect(engine).toContain('SCREENER / STOCK HUNTING GUIDANCE');
    expect(engine).toContain('/scan');
    expect(engine).toContain('today / intraday');
    expect(engine).toContain('never hard rules');
    expect(engine).toContain('it is the primary tool');
    expect(engine).toContain('for any watchlist/picks request');
    expect(engine).toContain('Always run stock_screener first');
    expect(engine).toContain('questions inside the composer');
    expect(engine).toContain('ask_user_questions');
    expect(engine).toContain('No market bias');
    expect(engine).toContain('never default to "idx"');
  });

  it('short-circuits market-less screener requests with a picker payload before any tool call', () => {
    expect(engine).toContain('detectScreenerMarketFollowUp');
    expect(engine).toContain("type: 'follow_up'");
    expect(engine).toContain('createMarketFollowUp');
    expect(engine).not.toContain('pick a market below');
  });

  it('routes casual buy-today questions through the screener evidence flow', () => {
    expect(engine).toContain('what good stuff can I buy');
    expect(engine).toContain('Run the evidence flow in order');
    expect(engine).toContain('Rank the verified candidates');
    expect(engine).toContain('Close a screener answer by offering the next step');
    expect(engine).toContain('intraday or longterm');
  });

  it('keeps the post-scan evidence flow and memory-free picks rule', () => {
    expect(engine).toContain('call fetch_price on the top 2-3 BUY candidates');
    expect(engine).toContain('lazy defaults');
    expect(engine).toContain('citing the score, volume');
  });
});
