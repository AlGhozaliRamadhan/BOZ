import { describe, expect, it } from 'vitest';
import { toolLabel } from '../src/shared/tool-labels.js';

// The thinking panel used to print wire names — `fetch_ticker_dashboard` — to
// people. These pin the label contract: progressive while running, past when
// done, retry form under a transient failure, and the ticker/query dropped in
// whenever the call carried one.

describe('toolLabel', () => {
  it('names the ticker and phases dashboard loads', () => {
    expect(toolLabel('fetch_ticker_dashboard', { symbol: 'VOO' }, 'running'))
      .toBe('Loading VOO dashboard');
    expect(toolLabel('fetch_ticker_dashboard', { symbol: 'VOO' }, 'done'))
      .toBe('Loaded VOO dashboard');
    expect(toolLabel('fetch_ticker_dashboard', { symbol: 'VOO' }, 'retry'))
      .toBe('Retrying VOO dashboard');
  });

  it('phases the other data tools the same way', () => {
    expect(toolLabel('fetch_price', { symbol_or_name: 'NVDA' }, 'running'))
      .toBe('Checking NVDA price');
    expect(toolLabel('fetch_price', { symbol_or_name: 'NVDA' }, 'done'))
      .toBe('Checked NVDA price');
    expect(toolLabel('web_search', { query: 'NVDA earnings' }, 'running'))
      .toBe('Searching the web for "NVDA earnings"');
    expect(toolLabel('web_search', { query: 'NVDA earnings' }, 'done'))
      .toBe('Searched the web for "NVDA earnings"');
    expect(toolLabel('web_search', { query: 'NVDA earnings' }, 'retry'))
      .toBe('Retrying the web search');
    expect(toolLabel('fetch_sentiment', {}, 'done')).toBe('Read crowd sentiment');
    expect(toolLabel('fetch_global_market_snapshot', undefined, 'running'))
      .toBe('Checking global markets');
  });

  it('falls back to a readable noun when the call carried no subject', () => {
    expect(toolLabel('fetch_ticker_dashboard', {}, 'running')).toBe('Loading the dashboard');
    expect(toolLabel('web_search', {}, 'done')).toBe('Searched the web');
  });

  it('never shows raw snake_case, even for unknown tools', () => {
    expect(toolLabel('sudden_new_plumbing', {}, 'done')).toBe('Sudden New Plumbing finished');
    expect(toolLabel('sudden_new_plumbing', {}, 'running')).toBe('Running Sudden New Plumbing');
    expect(toolLabel('sudden_new_plumbing', {}, 'retry')).toBe('Retrying Sudden New Plumbing');
  });

  it('carries the subject into risk-plan validation', () => {
    expect(toolLabel('risk_calc', { symbol: 'NVDA' }, 'running')).toBe('Validating the NVDA trade plan');
    expect(toolLabel('risk_calc', { symbol: 'NVDA' }, 'done')).toBe('Validated the NVDA trade plan');
    expect(toolLabel('fx_risk_calc', {}, 'done')).toBe('Validated the trade plan');
  });

  it('describes skill and screener calls in plain nouns', () => {
    expect(toolLabel('get_skill', { name: '/intraday' }, 'running'))
      .toBe('Loading the intraday skill');
    expect(toolLabel('scan_indonesia_momentum', { universe: 'idx' }, 'done'))
      .toBe('Scanned the IDX screener');
    expect(toolLabel('list_skills', {}, 'running')).toBe('Reviewing BOZ skills');
  });
});
