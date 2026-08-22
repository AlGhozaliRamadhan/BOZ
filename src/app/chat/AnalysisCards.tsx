import React from 'react';
import { ThoughtAccordion } from '../components/ui/ThoughtAccordion';
import VerdictBox from '../components/ui/VerdictBox';
import TradeLevels from '../components/ui/TradeLevels';

const fmt = (v: number | null | undefined, d = 2) => v != null ? v.toFixed(d) : '--';
const money = (v: number | null | undefined, d = 2) => v != null ? `$${v.toFixed(d)}` : '--';

function PriceStrip({ ticker, price }: { ticker?: string; price?: number | null }) {
  if (price == null && !ticker) return null;
  return (
    <div className="analysis-price-strip">
      <span className="analysis-price-ticker">{ticker || 'PRICE'}</span>
      <span className="analysis-price-value">{money(price)}</span>
    </div>
  );
}

export function IntradayCard({ data }: { data: any }) {
  if (!data) return null;
  const { verdict, marketData: md, macro, sentiment: sent, chartPatterns: cp, tradeLevels: tl, thoughts, ticker } = data;
  const isBull = verdict?.prediction === 'UP';
  const cardThoughts = thoughts || verdict?.thoughts || verdict?.reasons || (verdict?.thought ? [verdict.thought] : []);
  const prediction = verdict?.prediction === 'UP' || verdict?.prediction === 'DOWN' ? verdict.prediction : 'UNKNOWN';
  const sym = (ticker || 'TICKER').toUpperCase();

  return (
    <div className="flex-col gap-4" style={{ marginBottom: '14px' }}>
      {cardThoughts && cardThoughts.length > 0 && (
        <ThoughtAccordion
          thoughts={cardThoughts}
          title="Intraday AI Reasoning Process"
          defaultOpen={false}
          accent={isBull ? 'bull' : 'bear'}
        />
      )}

      <PriceStrip ticker={sym} price={md?.current_price} />

      {verdict && (
        <VerdictBox
          prediction={prediction}
          confidence={typeof verdict.confidence === 'number' ? verdict.confidence : 0}
          strategy={verdict.strategy || verdict.reason}
        />
      )}

      {tl && (tl.entryRange || tl.targetRange || tl.stopLoss) && (
        <TradeLevels
          entry={tl.entryRange || '--'}
          target={tl.targetRange || '--'}
          stop={tl.stopLoss || '--'}
          action="Trade levels"
        />
      )}

      {/* Strategic Thesis & Vision */}
      {verdict?.thesis && (
        <div className="analysis-thesis-card">
          <div className="analysis-thesis-header">
            <i className="fa-solid fa-compass" style={{ color: 'var(--accent-cyan)' }}></i>
            <span>Intraday Session Vision & Market Structure</span>
          </div>
          <div className="analysis-thesis-body">
            {verdict.thesis}
          </div>
        </div>
      )}

      {/* Strategic Catalyst Pillars */}
      {verdict?.reasons && verdict.reasons.length > 0 && (
        <div className="analysis-catalyst-card">
          <div className="analysis-catalyst-header">
            <i className="fa-solid fa-bolt" style={{ color: 'var(--accent-cyan)' }}></i>
            <span>Key Session Catalysts</span>
          </div>
          <ul className="analysis-catalyst-list">
            {verdict.reasons.map((r: string, idx: number) => (
              <li key={idx}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick Summary Pill Bar */}
      <div className="analysis-summary-bar">
        {md?.rsi != null && (
          <div className="analysis-summary-pill">
            <span className="analysis-pill-label">RSI</span>
            <span className={`analysis-pill-val ${md.rsi > 70 ? 'text-bear' : md.rsi < 30 ? 'text-bull' : ''}`}>{fmt(md.rsi, 1)}</span>
          </div>
        )}
        {macro?.market_regime && (
          <div className="analysis-summary-pill">
            <span className="analysis-pill-label">Regime</span>
            <span className="analysis-pill-val">{macro.market_regime}</span>
          </div>
        )}
        {macro?.vix_level != null && (
          <div className="analysis-summary-pill">
            <span className="analysis-pill-label">VIX</span>
            <span className="analysis-pill-val">{fmt(macro.vix_level, 1)}</span>
          </div>
        )}
        {sent?.fear_greed?.value != null && (
          <div className="analysis-summary-pill">
            <span className="analysis-pill-label">Sentiment</span>
            <span className="analysis-pill-val">{sent.fear_greed.value}</span>
          </div>
        )}
      </div>

      {/* Dashboard Deep-Dive CTA */}
      <div className="analysis-dashboard-cta">
        <div className="analysis-dashboard-cta-text">
          <span className="analysis-dashboard-cta-title">Explore {sym} Ticker Dashboard</span>
          <span className="analysis-dashboard-cta-sub">Interactive chart, multi-timeframe indicators, order book & live news</span>
        </div>
        <a
          href={`/dashboard/${encodeURIComponent(sym)}`}
          className="analysis-dashboard-cta-btn"
        >
          <span>Open Dashboard</span>
          <i className="fa-solid fa-arrow-up-right-from-square"></i>
        </a>
      </div>
    </div>
  );
}

export function LongtermCard({ data }: { data: any }) {
  if (!data) return null;
  const { verdict, marketData: md, macro, sentiment: sent, chartPatterns: cp, tradeLevels: tl, thoughts, ticker } = data;
  const isBull = verdict?.prediction === 'UP';
  const cardThoughts = thoughts || verdict?.thoughts || verdict?.reasons || (verdict?.thought ? [verdict.thought] : []);
  const prediction = verdict?.prediction === 'UP' || verdict?.prediction === 'DOWN' ? verdict.prediction : 'UNKNOWN';
  const sym = (ticker || 'TICKER').toUpperCase();

  return (
    <div className="flex-col gap-4" style={{ marginBottom: '14px' }}>
      {cardThoughts && cardThoughts.length > 0 && (
        <ThoughtAccordion
          thoughts={cardThoughts}
          title="Long-Term Fundamental Thesis & Reasoning"
          defaultOpen={false}
          accent={isBull ? 'bull' : 'bear'}
        />
      )}

      <PriceStrip ticker={sym} price={md?.current_price} />

      {verdict && (
        <VerdictBox
          prediction={prediction}
          confidence={typeof verdict.confidence === 'number' ? verdict.confidence : 0}
          strategy={verdict.strategy || verdict.reason}
        />
      )}

      {tl && (tl.entryRange || tl.targetRange || tl.stopLoss) && (
        <TradeLevels
          entry={tl.entryRange || '--'}
          target={tl.targetRange || '--'}
          stop={tl.stopLoss || '--'}
          action="Long-term levels"
        />
      )}

      {/* Strategic Investment Thesis & Business Vision */}
      {verdict?.thesis && (
        <div className="analysis-thesis-card">
          <div className="analysis-thesis-header">
            <i className="fa-solid fa-compass" style={{ color: 'var(--accent-cyan)' }}></i>
            <span>Investment Thesis & Secular Business Vision</span>
          </div>
          <div className="analysis-thesis-body">
            {verdict.thesis}
          </div>
        </div>
      )}

      {/* Strategic Catalyst Pillars */}
      {verdict?.reasons && verdict.reasons.length > 0 && (
        <div className="analysis-catalyst-card">
          <div className="analysis-catalyst-header">
            <i className="fa-solid fa-bolt" style={{ color: 'var(--accent-cyan)' }}></i>
            <span>Secular Catalysts & Strategic Pillars</span>
          </div>
          <ul className="analysis-catalyst-list">
            {verdict.reasons.map((r: string, idx: number) => (
              <li key={idx}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 52-Week Context Bar */}
      {md?.fiftyTwoWeekHigh != null && (
        <div className="analysis-summary-bar">
          <div className="analysis-summary-pill">
            <span className="analysis-pill-label">52W High</span>
            <span className="analysis-pill-val">${fmt(md.fiftyTwoWeekHigh)}</span>
          </div>
          <div className="analysis-summary-pill">
            <span className="analysis-pill-label">From High</span>
            <span className="analysis-pill-val text-bear">{fmt(md.from52wHigh, 1)}%</span>
          </div>
          <div className="analysis-summary-pill">
            <span className="analysis-pill-label">52W Low</span>
            <span className="analysis-pill-val">${fmt(md.fiftyTwoWeekLow)}</span>
          </div>
          <div className="analysis-summary-pill">
            <span className="analysis-pill-label">From Low</span>
            <span className="analysis-pill-val text-bull">+{fmt(md.from52wLow, 1)}%</span>
          </div>
        </div>
      )}

      {/* Dashboard Deep-Dive CTA */}
      <div className="analysis-dashboard-cta">
        <div className="analysis-dashboard-cta-text">
          <span className="analysis-dashboard-cta-title">Explore {sym} Ticker Dashboard</span>
          <span className="analysis-dashboard-cta-sub">Interactive chart, multi-timeframe indicators, order book & live news</span>
        </div>
        <a
          href={`/dashboard/${encodeURIComponent(sym)}`}
          className="analysis-dashboard-cta-btn"
        >
          <span>Open Dashboard</span>
          <i className="fa-solid fa-arrow-up-right-from-square"></i>
        </a>
      </div>
    </div>
  );
}

export function NewsIntelCard({ data }: { data: any }) {
  if (!data) return null;
  const { sentiment: sent, thoughts, summary } = data;
  const intelThoughts = thoughts || sent?.summary?.overall_signals || (summary?.thoughts ? summary.thoughts : []);

  return (
    <div className="glass-card" style={{ padding: '16px', marginBottom: '16px', fontSize: '14px', borderRadius: 'var(--radius-lg)', background: 'var(--surface-glass)', border: '1px solid var(--border-glass)' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 600 }}>News Intelligence</h3>
      
      {/* News Intel AI Thought Process Accordion */}
      {intelThoughts && intelThoughts.length > 0 && (
        <div style={{ marginBottom: '14px' }}>
          <ThoughtAccordion
            thoughts={intelThoughts}
            title="News Intel AI Synthesis & Macro Deductions"
            defaultOpen={false}
            accent="violet"
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        {sent && (
          <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>SENTIMENT OVERVIEW</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Fear & Greed</span> <strong>{sent.fear_greed?.value || '--'} ({sent.fear_greed?.label || '--'})</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>StockTwits Bulls</span> <strong>{sent.stocktwits_data?.bull_ratio ? sent.stocktwits_data.bull_ratio.toFixed(0) + '%' : '--'}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Headlines Analyzed</span> <strong>{data.totalHeadlines || '--'}</strong></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
