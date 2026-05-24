import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// We import the instance and the type
import { sessionLogService, SessionEntry } from '../src/services/core/session.log.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH  = path.join(__dirname, '../data/session.log.json');

describe('SessionLogService', () => {
  const dummyEntry: SessionEntry = {
    timestamp: new Date().toISOString(),
    regime: 'BULL_MARKET',
    marketSummary: 'Testing summary',
    opportunities: [
      {
        asset: 'BTC',
        action: 'BUY',
        conviction: 'HIGH',
        confidence: 85,
        entry_range: '60000',
        target_range: '65000',
        stop_loss: '58000',
        spot_price: 61000
      }
    ],
    catalysts: ['FOMC Meeting'],
    toolCallCount: 5
  };

  // Helper to clear state
  const resetService = () => {
    (sessionLogService as any).entries = [];
    (sessionLogService as any).loaded = false;
  };

  beforeEach(() => {
    // Clean up test file before each test
    if (fs.existsSync(LOG_PATH)) {
      fs.unlinkSync(LOG_PATH);
    }
    resetService();
  });

  afterEach(() => {
    if (fs.existsSync(LOG_PATH)) {
      fs.unlinkSync(LOG_PATH);
    }
    resetService();
  });

  it('returns null when no previous session exists', () => {
    const lastSession = sessionLogService.getLastSession();
    expect(lastSession).toBeNull();
  });

  it('saves and retrieves the latest session', () => {
    sessionLogService.saveSession(dummyEntry);
    
    const lastSession = sessionLogService.getLastSession();
    expect(lastSession).not.toBeNull();
    expect(lastSession?.regime).toBe('BULL_MARKET');
    expect(lastSession?.opportunities[0].asset).toBe('BTC');
    expect(lastSession?.catalysts).toContain('FOMC Meeting');
  });

  it('keeps only the last MAX_ENTRIES (10) sessions', () => {
    // Save 12 entries
    for (let i = 0; i < 12; i++) {
      sessionLogService.saveSession({
        ...dummyEntry,
        regime: `REGIME_${i}`
      });
    }

    const entries = (sessionLogService as any).entries;
    expect(entries.length).toBe(10);
    // The first two (0, 1) should be gone, leaving 2 through 11
    expect(entries[0].regime).toBe('REGIME_2');
    expect(entries[9].regime).toBe('REGIME_11');
  });

  it('builds a retrospective context string correctly', () => {
    sessionLogService.saveSession(dummyEntry);
    const lastSession = sessionLogService.getLastSession();
    
    const retro = sessionLogService.buildRetrospectiveContext(lastSession!);
    
    expect(retro).toContain('PREVIOUS SESSION RETROSPECTIVE');
    expect(retro).toContain('Regime: BULL_MARKET');
    expect(retro).toContain('BUY BTC @ HIGH conviction (85%)');
    expect(retro).toContain('Catalysts flagged: FOMC Meeting');
    expect(retro).toContain('RETROSPECTIVE TASK: For each call above');
  });

  it('handles empty opportunities and catalysts gracefully in context builder', () => {
    const emptyEntry: SessionEntry = {
      ...dummyEntry,
      opportunities: [],
      catalysts: []
    };
    
    const retro = sessionLogService.buildRetrospectiveContext(emptyEntry);
    expect(retro).toContain('Calls made (0):');
    expect(retro).toContain('  none');
    expect(retro).toContain('  No specific catalysts flagged.');
  });
});
