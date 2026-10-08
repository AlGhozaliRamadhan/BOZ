import { risk_calc } from '../shared/risk-math.js';

// ─── Tool Definitions (JSON Schemas) ─────────────────────────────────────────

export const riskCalcDefinition = {
  type: 'function' as const,
  function: {
    name: 'risk_calc',
    description: [
      'Deterministic trade math: stop distance, stop ATR multiple, position sizing,',
      'per-target R:R and warnings. Use for every entry/stop/target before presenting a plan.',
      'Report R:R exactly as returned, once. Never do arithmetic yourself.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Ticker symbol (e.g. NVDA)' },
        side: { type: 'string', enum: ['long', 'short'], description: 'Trade direction' },
        entry: { type: 'number', description: 'Entry price' },
        stop: { type: 'number', description: 'Stop-loss price' },
        targets: {
          type: 'array',
          items: { type: 'number' },
          description: 'Ordered profit targets TP1, TP2, ...',
        },
        atr: { type: 'number', description: 'Average True Range' },
        account_equity: { type: 'number', description: 'Account equity for sizing (omit to skip sizing)' },
        risk_pct: { type: 'number', description: 'Risk percent per trade (default 1.0)' },
      },
      required: ['symbol', 'side', 'entry', 'stop', 'targets', 'atr'],
    },
  },
};

// ─── Tool Executors ───────────────────────────────────────────────────────────

/**
 * Round to 2 decimals. risk_calc itself stays pure (no rounding inside);
 * the TOOL OUTPUT is rounded so the model never sees float garbage like
 * 48.50999999999999 and can quote every number verbatim.
 */
function round2(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

export async function executeRiskCalc(args: Record<string, any>): Promise<string> {
  const symbol = String(args.symbol ?? '');
  const side = args.side;
  const entry = Number(args.entry);
  const stop = Number(args.stop);
  const targets = Array.isArray(args.targets) ? args.targets.map((t: unknown) => Number(t)) : [];
  const atr = Number(args.atr);
  const result = risk_calc({
    symbol,
    side,
    entry,
    stop,
    targets,
    atr,
    account_equity: args.account_equity == null ? null : Number(args.account_equity),
    risk_pct: args.risk_pct == null ? 1.0 : Number(args.risk_pct),
  });
  // Echo every input (so plan numbers exist as TOOL OUTPUT, not just call
  // arguments) and round every float to 2 decimals. position_size is an
  // integer share count by construction and passes through untouched.
  return JSON.stringify({
    tool: 'risk_calc',
    symbol,
    side,
    entry: round2(entry),
    stop: round2(stop),
    targets: targets.map(round2),
    atr: round2(atr),
    stop_distance: round2(result.stop_distance),
    stop_atr_multiple: round2(result.stop_atr_multiple),
    position_size: result.position_size,
    per_target: result.per_target.map((p) => ({ target: round2(p.target), rr: round2(p.rr) })),
    warnings: result.warnings,
  });
}

// ─── Fact Extractors ──────────────────────────────────────────────────────────

export function extractRiskCalcFact(args: Record<string, any>, obs: string) {
  try {
    const parsed = JSON.parse(obs) as {
      stop_distance?: number | null;
      per_target?: Array<{ target: number; rr: number | null }>;
      warnings?: string[];
    };
    const rrs = (parsed.per_target ?? [])
      .map((p) => (p.rr == null ? 'n/a' : p.rr.toFixed(2)))
      .join(', ');
    return {
      step: 0,
      tool: 'risk_calc',
      fact: `risk_calc ${String(args.symbol ?? '')} ${String(args.side ?? '')}: stop_distance ${parsed.stop_distance ?? 'n/a'}, R:R [${rrs}]${parsed.warnings?.length ? ` warnings: ${parsed.warnings.join('; ')}` : ''}`,
      quality: (parsed.stop_distance != null ? 'confirmed' : 'empty') as 'confirmed' | 'empty',
    };
  } catch {
    return {
      step: 0,
      tool: 'risk_calc',
      fact: `risk_calc returned non-JSON output`,
      quality: 'empty' as const,
    };
  }
}
