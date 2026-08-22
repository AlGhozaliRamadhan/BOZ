'use client';

import { useState } from 'react';

export interface ToolResult {
  tool: string;
  fact?: string;
  quality?: string;
  success?: boolean;
  preview?: string;
  args?: Record<string, unknown>;
  status?: 'running' | 'done';
}

function parsePrice(preview = '', fact = '') {
  const src = `${preview} ${fact}`;
  const symbol = src.match(/Symbol:\s*([^|]+)/)?.[1]?.trim();
  const name = src.match(/Name:\s*([^|]+)/)?.[1]?.trim();
  const price = src.match(/Price:\s*([\d,.]+)/)?.[1];
  const change = src.match(/Change:\s*([-\d.]+)%/)?.[1];
  const range = src.match(/Day Range:\s*([^|]+)/)?.[1]?.trim();
  const prev = src.match(/Prev Close:\s*([^|]+)/)?.[1]?.trim();
  return { symbol, name, price, change, range, prev };
}

function parseHeadlines(preview = '') {
  return preview
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function parseSentiment(preview = '', fact = '') {
  try {
    const json = JSON.parse(preview);
    return {
      fg: json.fear_greed?.value,
      fgl: json.fear_greed?.label,
      bull: json.reddit_buzz?.stocktwits?.bull_ratio,
      signals: json.overall_signals || [],
    };
  } catch {
    const fg = fact.match(/Fear & Greed\s+(\d+)/)?.[1];
    const fgl = fact.match(/Fear & Greed\s+\d+\s+\(([^)]+)\)/)?.[1];
    const bull = fact.match(/StockTwits\s+([\d.]+)%/)?.[1];
    return { fg, fgl, bull, signals: [] as string[] };
  }
}

const AGENT_PERSONAS: Record<string, { icon: string; role: string; color: string }> = {
  quantbrain: { icon: 'fa-calculator', role: 'Quantitative Analyst', color: 'var(--accent-cyan)' },
  newshound: { icon: 'fa-newspaper', role: 'Macro Intelligence', color: '#00d2ff' },
  riskmanager: { icon: 'fa-shield-halved', role: 'Risk Manager & Auditor', color: '#ff5252' },
  datagoblin: { icon: 'fa-database', role: 'Data & Relative Valuation', color: '#ab47bc' },
};

export function ToolResultStack({ results }: { results: ToolResult[] }) {
  if (!results?.length) return null;
  const done = results.filter((r) => r.status !== 'running');
  if (!done.length) return null;

  return (
    <div className="tool-result-stack">
      {done.map((r, i) => (
        <ToolResultCard key={`${r.tool}-${i}`} result={r} />
      ))}
    </div>
  );
}

function ToolResultCard({ result }: { result: ToolResult }) {
  const [expanded, setExpanded] = useState(false);
  const tool = result.tool;

  // 1. LIVE PRICE TOOL
  if (tool === 'fetch_price') {
    const p = parsePrice(result.preview, result.fact);
    const chg = p.change != null ? Number(p.change) : null;
    return (
      <div className="tool-card animate-fadeIn">
        <div className="tool-card-kicker">
          <i className="fa-solid fa-chart-line" style={{ marginRight: '5px' }}></i>
          Live Price Data
        </div>
        <div className="tool-card-row">
          <div>
            <div className="tool-card-title">{p.symbol || String(result.args?.symbol_or_name || 'Price')}</div>
            {p.name && <div className="tool-card-sub">{p.name}</div>}
          </div>
          <div className="tool-card-metric">
            <span className="tool-card-price">${p.price ?? '--'}</span>
            {chg != null && (
              <span className={`badge ${chg >= 0 ? 'badge-bull' : 'badge-bear'}`} style={{ fontSize: '11px', padding: '2px 8px' }}>
                {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
              </span>
            )}
          </div>
        </div>
        {(p.range || p.prev) && (
          <div className="tool-card-meta">
            {p.range && <span><strong style={{ color: 'var(--text-secondary)' }}>Day Range:</strong> {p.range}</span>}
            {p.prev && <span><strong style={{ color: 'var(--text-secondary)' }}>Prev Close:</strong> ${p.prev}</span>}
          </div>
        )}
      </div>
    );
  }

  // 2. NEWS & SEARCH TOOL
  if (tool === 'fetch_news' || tool === 'web_search') {
    const lines = parseHeadlines(result.preview);
    const isSearch = tool === 'web_search';
    const query = String(result.args?.query || result.fact || 'Search Query');
    return (
      <div className="tool-card animate-fadeIn">
        <div className="tool-card-kicker" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>
            <i className={isSearch ? 'fa-solid fa-globe' : 'fa-solid fa-newspaper'} style={{ marginRight: '5px' }}></i>
            {isSearch ? 'Web Intelligence' : 'Market News Feed'}
          </span>
          {result.quality && (
            <span className={`badge ${result.quality === 'confirmed' ? 'badge-bull' : 'badge-neutral'}`} style={{ fontSize: '9px', textTransform: 'uppercase' }}>
              {result.quality}
            </span>
          )}
        </div>
        <div className="tool-card-title" style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '6px' }}>
          {query}
        </div>
        {lines.length > 0 ? (
          <ul className="tool-card-list">
            {(expanded ? lines : lines.slice(0, 3)).map((line, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                <span style={{ color: 'var(--accent-cyan)', fontSize: '10px', marginTop: '3px' }}>•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="tool-card-sub">{result.fact || 'No headlines retrieved'}</div>
        )}
        {lines.length > 3 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-cyan)',
              fontSize: '11px',
              cursor: 'pointer',
              padding: '4px 0 0',
              marginTop: '4px',
              fontWeight: 500,
            }}
          >
            {expanded ? 'Show less' : `+${lines.length - 3} more sources`}
          </button>
        )}
      </div>
    );
  }

  // 3. SENTIMENT TOOL
  if (tool === 'fetch_sentiment') {
    const s = parseSentiment(result.preview, result.fact);
    const fgVal = s.fg != null ? Number(s.fg) : null;
    const bullVal = s.bull != null ? Number(s.bull) : null;
    return (
      <div className="tool-card animate-fadeIn">
        <div className="tool-card-kicker">
          <i className="fa-solid fa-gauge-high" style={{ marginRight: '5px' }}></i>
          Crowd Sentiment & Positioning
        </div>
        <div className="tool-card-grid">
          <div style={{ padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)' }}>
            <div className="tool-card-sub">Fear & Greed Index</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
              <span className="tool-card-price" style={{
                color: fgVal != null ? (fgVal > 60 ? '#00c853' : fgVal < 40 ? '#ff5252' : 'var(--text-primary)') : undefined
              }}>
                {s.fg ?? '--'}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{s.fgl ? `(${s.fgl})` : ''}</span>
            </div>
          </div>
          <div style={{ padding: '8px', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)' }}>
            <div className="tool-card-sub">StockTwits Crowd Ratio</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '4px' }}>
              <span className="tool-card-price" style={{
                color: bullVal != null ? (bullVal > 60 ? '#00c853' : bullVal < 40 ? '#ff5252' : 'var(--text-primary)') : undefined
              }}>
                {bullVal != null ? `${bullVal.toFixed(0)}%` : '--'}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Bullish</span>
            </div>
          </div>
        </div>
        {s.signals.length > 0 && (
          <div className="tool-card-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {s.signals.map((sig: string) => (
              <span key={sig} className={`badge ${
                sig.includes('BULL') ? 'badge-bull' :
                sig.includes('BEAR') || sig.includes('FEAR') ? 'badge-bear' :
                sig.includes('GREED') ? 'badge-warning' : 'badge-neutral'
              }`} style={{ fontSize: '10px' }}>
                {sig}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 4. SUB-AGENT DELEGATION TOOL
  if (tool === 'summon_agent') {
    const agentName = String(result.args?.agent_name || 'Agent').toLowerCase();
    const persona = AGENT_PERSONAS[agentName] || { icon: 'fa-robot', role: 'Specialized Sub-Agent', color: 'var(--accent-cyan)' };
    const task = String(result.args?.task || '');
    return (
      <div className="tool-card animate-fadeIn" style={{ borderLeft: `3px solid ${persona.color}` }}>
        <div className="tool-card-kicker" style={{ color: persona.color, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className={`fa-solid ${persona.icon}`}></i>
          Sub-Agent: {result.args?.agent_name ? String(result.args.agent_name) : 'Specialist'} ({persona.role})
        </div>
        {task && (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
            <strong>Task:</strong> {task}
          </div>
        )}
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, background: 'rgba(255,255,255,0.02)', padding: '8px 10px', borderRadius: 'var(--radius-sm)' }}>
          {result.fact || result.preview || 'Sub-agent analysis complete.'}
        </div>
      </div>
    );
  }

  // 5. INDONESIA SCAN TOOL
  if (tool === 'scan_indonesia_momentum') {
    const lines = parseHeadlines(result.preview);
    return (
      <div className="tool-card animate-fadeIn">
        <div className="tool-card-kicker">
          <i className="fa-solid fa-radar" style={{ marginRight: '5px' }}></i>
          IDX Momentum Scanner
        </div>
        <div className="tool-card-title" style={{ fontSize: '13px' }}>{result.fact || 'Momentum scan'}</div>
        {lines.length > 0 && (
          <ul className="tool-card-list">
            {(expanded ? lines : lines.slice(0, 4)).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
        {lines.length > 4 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--accent-cyan)',
              fontSize: '11px',
              cursor: 'pointer',
              padding: '4px 0 0',
              marginTop: '4px',
              fontWeight: 500,
            }}
          >
            {expanded ? 'Show less' : `+${lines.length - 4} more candidates`}
          </button>
        )}
      </div>
    );
  }

  // 6. MEMORY UPDATE TOOL
  if (tool === 'update_memory') {
    return (
      <div className="tool-card animate-fadeIn" style={{ borderLeft: '3px solid var(--accent-cyan)' }}>
        <div className="tool-card-kicker">
          <i className="fa-solid fa-brain" style={{ marginRight: '5px' }}></i>
          Long-Term Memory Stored
        </div>
        <div className="tool-card-sub" style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
          {String(result.args?.fact || result.fact || 'Preference saved')}
        </div>
      </div>
    );
  }

  // GENERIC FALLBACK
  return (
    <div className="tool-card animate-fadeIn">
      <div className="tool-card-kicker">{tool.replace(/_/g, ' ')}</div>
      <div className="tool-card-sub">{result.fact || (result.success === false ? 'No data' : 'Done')}</div>
    </div>
  );
}
