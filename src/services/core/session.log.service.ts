// ─── services/session.log.service.ts ─────────────────────────────────────────
// Persists News-Intel sessions to data/session.log.json so the agent can
// perform a post-event retrospective at the start of every new run.

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH   = path.join(__dirname, '../../../data/session.log.json');
const MAX_ENTRIES = 10;

export interface SessionOpportunity {
  asset:       string;
  action:      string;
  confidence:  number;
  conviction:  string;
  entry_range: string;
  target_range: string;
  stop_loss:   string;
  spot_price?: number;
}

export interface SessionEntry {
  timestamp:     string;   // ISO
  regime:        string;
  marketSummary: string;
  opportunities: SessionOpportunity[];
  catalysts:     string[];  // upcoming catalysts noted that session
  toolCallCount: number;
}

class SessionLogService {
  private entries: SessionEntry[] = [];
  private loaded  = false;

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(LOG_PATH)) {
        this.entries = JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8'));
      }
    } catch { this.entries = []; }
  }

  /** Returns the most recent session entry, or null if none. */
  getLastSession(): SessionEntry | null {
    this.load();
    return this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
  }

  /** Saves a new session entry (keeps the last MAX_ENTRIES). */
  saveSession(entry: SessionEntry): void {
    this.load();
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    try {
      const dir = path.dirname(LOG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(LOG_PATH, JSON.stringify(this.entries, null, 2));
    } catch { /* silent — never block a session over persistence */ }
  }

  /**
   * Builds a concise retrospective string to inject into the agent's initial prompt.
   * Lets the agent reason about whether its previous calls aged well.
   */
  buildRetrospectiveContext(last: SessionEntry): string {
    const ago = Math.round((Date.now() - new Date(last.timestamp).getTime()) / 60_000);
    const agoStr = ago < 60 ? `${ago}min ago` : `${Math.round(ago / 60)}h ago`;

    const oppLines = last.opportunities
      .map(o =>
        `  • ${o.action} ${o.asset} @ ${o.conviction} conviction (${o.confidence}%) ` +
        `— entry ${o.entry_range}, target ${o.target_range}, stop ${o.stop_loss}` +
        (o.spot_price ? `, spot was $${o.spot_price.toLocaleString()}` : ''),
      )
      .join('\n');

    const catalystLines = last.catalysts.length
      ? `  Catalysts flagged: ${last.catalysts.join('; ')}`
      : '  No specific catalysts flagged.';

    return [
      `── PREVIOUS SESSION RETROSPECTIVE (${agoStr}) ──────────────────────`,
      `Regime: ${last.regime}  |  Summary: ${last.marketSummary.slice(0, 120)}`,
      `Calls made (${last.opportunities.length}):`,
      oppLines || '  none',
      catalystLines,
      ``,
      `RETROSPECTIVE TASK: For each call above, check the live price now (fetch_price).`,
      `If the trade moved in the predicted direction → note "AGED WELL".`,
      `If it moved against → note "MISS" and briefly explain why.`,
      `Use this to calibrate your confidence before making new calls.`,
      `──────────────────────────────────────────────────────────────────────`,
    ].join('\n');
  }
}

export const sessionLogService = new SessionLogService();
