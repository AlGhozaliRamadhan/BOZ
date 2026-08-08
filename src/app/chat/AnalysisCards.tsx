import React from 'react';
import { ThoughtAccordion } from '../components/ui/ThoughtAccordion';

const fmt = (v: number | null | undefined, d = 2) => v != null ? v.toFixed(d) : '—';

export function IntradayCard({ data }: { data: any }) {
  if (!data) return null;
  const { verdict, marketData: md, macro, sentiment: sent, chartPatterns: cp, tradeLevels: tl, thoughts } = data;
  const isOk = verdict?.status === 'ok';
  const isBull = verdict?.prediction === 'UP';
  const cardThoughts = thoughts || verdict?.thoughts || verdict?.reasons || (verdict?.thought ? [verdict.thought] : []);

  return (
    <div className="flex-col gap-6" style={{ marginBottom: '16px' }}>
      {/* AI Thought Process Accordion */}
      {cardThoughts && cardThoughts.length > 0 && (
        <ThoughtAccordion
          thoughts={cardThoughts}
          title="Intraday AI Reasoning Process"
          defaultOpen={false}
          accent={isBull ? 'bull' : 'bear'}
        />
      )}


      {/* Technical + Macro Row */}
      <div className="grid-2 gap-4">
        {/* Technical Indicators */}
        <div className="glass-card">
          <div className="card-header">
            <span className="card-title">Technical Indicators</span>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Indicator</th><th>Value</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>RSI (14)</td>
                <td className={md?.rsi > 70 ? 'table-cell-negative' : md?.rsi < 30 ? 'table-cell-positive' : ''}>{fmt(md?.rsi, 1)}</td>
              </tr>
              <tr>
                <td>MACD</td>
                <td className={(md?.macd ?? 0) >= 0 ? 'table-cell-positive' : 'table-cell-negative'}>{fmt(md?.macd, 4)}</td>
              </tr>
              <tr><td>SMA 20</td><td>${fmt(md?.sma_20)}</td></tr>
              <tr><td>SMA 50</td><td>${fmt(md?.sma_50)}</td></tr>
              <tr><td>SMA 200</td><td>${fmt(md?.sma_200)}</td></tr>
              <tr><td>ATR</td><td>{fmt(md?.atr, 4)} ({fmt(md?.atr_percent)}%)</td></tr>
              <tr><td>BB Width</td><td>{fmt(md?.bb_width, 4)}</td></tr>
              <tr>
                <td>Volume Ratio</td>
                <td className={(md?.volume_ratio ?? 0) > 1.5 ? 'table-cell-positive' : ''}>{fmt(md?.volume_ratio)}x</td>
              </tr>
              <tr><td>OBV Trend</td><td>{md?.obv_trend ? '🟢 Bullish' : '🔴 Bearish'}</td></tr>
            </tbody>
          </table>
        </div>

        {/* Macro Context */}
        <div className="glass-card">
          <div className="card-header">
            <span className="card-title">Macro Context</span>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Metric</th><th>Value</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Market Regime</td>
                <td>
                  <span className={`badge ${
                    macro?.market_regime?.toLowerCase().includes('bull') ? 'badge-bull' :
                    macro?.market_regime?.toLowerCase().includes('bear') ? 'badge-bear' :
                    'badge-neutral'
                  }`}>{macro?.market_regime ?? '—'}</span>
                </td>
              </tr>
              <tr>
                <td>Risk Sentiment</td>
                <td>
                  <span className={`badge ${
                    macro?.risk_sentiment === 'RISK_ON' ? 'badge-bull' :
                    macro?.risk_sentiment === 'RISK_OFF' ? 'badge-bear' :
                    'badge-neutral'
                  }`}>{macro?.risk_sentiment ?? '—'}</span>
                </td>
              </tr>
              <tr><td>SPY Correlation</td><td>{macro?.sp500_correlation ?? '—'}</td></tr>
              <tr><td>NASDAQ Correlation</td><td>{macro?.nasdaq_correlation ?? '—'}</td></tr>
              <tr>
                <td>VIX Level</td>
                <td className={(macro?.vix_level ?? 0) > 25 ? 'table-cell-negative' : 'table-cell-positive'}>
                  {fmt(macro?.vix_level)}
                </td>
              </tr>
              <tr><td>10Y Yield</td><td>{fmt(macro?.tnx_yield)}%</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Patterns + Sentiment Row */}
      <div className="grid-2 gap-4">
        {/* Chart Patterns */}
        <div className="glass-card">
          <div className="card-header">
            <span className="card-title">Chart Patterns</span>
          </div>
          {cp?.patterns?.length > 0 ? (
            <div className="flex-col gap-2">
              {cp.patterns.map((p: string, i: number) => (
                <div key={i} className="flex-row justify-between items-center" style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-glass)' }}>
                  <span style={{ fontSize: '13px' }}>{p}</span>
                  <span className={`badge ${
                    cp.pattern_confidence?.[i] === 'HIGH' ? 'badge-high' :
                    cp.pattern_confidence?.[i] === 'MEDIUM' ? 'badge-medium' : 'badge-low'
                  }`}>{cp.pattern_confidence?.[i] ?? '—'}</span>
                </div>
              ))}
              <div style={{ padding: 'var(--space-2) 0' }}>
                <span className="card-title">Fibonacci: </span>
                <span className="badge badge-cyan">{cp.fibonacci_position}</span>
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <p className="empty-state-text">No patterns detected</p>
            </div>
          )}
        </div>

        {/* Sentiment */}
        <div className="glass-card">
          <div className="card-header">
            <span className="card-title">Sentiment</span>
          </div>
          <table className="data-table">
            <thead>
              <tr><th>Signal</th><th>Value</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Fear &amp; Greed</td>
                <td>
                  <span className={`badge ${
                    (sent?.fear_greed?.value ?? 50) > 60 ? 'badge-bull' :
                    (sent?.fear_greed?.value ?? 50) < 40 ? 'badge-bear' : 'badge-neutral'
                  }`}>{sent?.fear_greed?.value ?? '—'} ({sent?.fear_greed?.label ?? '—'})</span>
                </td>
              </tr>
              <tr>
                <td>StockTwits</td>
                <td>
                  <span className={`badge ${
                    (sent?.stocktwits_data?.bull_ratio ?? 50) > 60 ? 'badge-bull' :
                    (sent?.stocktwits_data?.bull_ratio ?? 50) < 40 ? 'badge-bear' : 'badge-neutral'
                  }`}>{fmt(sent?.stocktwits_data?.bull_ratio, 0)}% bullish</span>
                </td>
              </tr>
              <tr>
                <td>Reddit</td>
                <td><span className="badge badge-violet">{sent?.social_buzz?.length ?? 0} sources</span></td>
              </tr>
              <tr>
                <td>Overall</td>
                <td>
                  {sent?.summary?.overall_signals?.map((s: string, i: number) => (
                    <span key={i} className={`badge ${
                      s.includes('BULL') ? 'badge-bull' :
                      s.includes('BEAR') ? 'badge-bear' :
                      s.includes('FEAR') ? 'badge-bear' :
                      s.includes('GREED') ? 'badge-warning' : 'badge-neutral'
                    }`} style={{ marginRight: '4px', fontSize: '10px' }}>{s}</span>
                  )) ?? '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function LongtermCard({ data }: { data: any }) {
  if (!data) return null;
  const { verdict, marketData: md, macro, sentiment: sent, chartPatterns: cp, thoughts } = data;
  const isOk = verdict?.status === 'ok';
  const isBull = verdict?.prediction === 'UP';
  const cardThoughts = thoughts || verdict?.thoughts || verdict?.reasons || (verdict?.thought ? [verdict.thought] : []);

  const fmt = (v: number | null | undefined, decimals = 2) =>
    v != null ? v.toFixed(decimals) : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
      {/* Long-term AI Thought Process Accordion */}
      {cardThoughts && cardThoughts.length > 0 && (
        <ThoughtAccordion
          thoughts={cardThoughts}
          title="Long-Term Fundamental Thesis & Reasoning"
          defaultOpen={false}
          accent={isBull ? 'bull' : 'bear'}
        />
      )}

      {md?.fiftyTwoWeekHigh && (
        <div className="glass-card compact" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>52-Week Context</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)' }}>
            <div><span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>52W High</span><br /><span style={{ fontWeight: 600 }}>${fmt(md.fiftyTwoWeekHigh)}</span></div>
            <div><span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>From High</span><br /><span style={{ fontWeight: 600, color: 'var(--bear)' }}>{fmt(md.from52wHigh, 1)}%</span></div>
            <div><span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>52W Low</span><br /><span style={{ fontWeight: 600 }}>${fmt(md.fiftyTwoWeekLow)}</span></div>
            <div><span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>From Low</span><br /><span style={{ fontWeight: 600, color: 'var(--bull)' }}>+{fmt(md.from52wLow, 1)}%</span></div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <div className="glass-card" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>Technical Indicators</div>
          <table className="data-table" style={{ width: '100%', fontSize: 'var(--text-xs)' }}>
            <thead><tr><th style={{ textAlign: 'left', paddingBottom: '8px' }}>Indicator</th><th style={{ textAlign: 'right', paddingBottom: '8px' }}>Value</th></tr></thead>
            <tbody>
              <tr><td>RSI (14)</td><td style={{ textAlign: 'right' }} className={md?.rsi > 70 ? 'table-cell-negative' : md?.rsi < 30 ? 'table-cell-positive' : ''}>{fmt(md?.rsi, 1)}</td></tr>
              <tr><td>MACD</td><td style={{ textAlign: 'right' }} className={(md?.macd ?? 0) >= 0 ? 'table-cell-positive' : 'table-cell-negative'}>{fmt(md?.macd, 4)}</td></tr>
              <tr><td>SMA 20</td><td style={{ textAlign: 'right' }}>${fmt(md?.sma_20)}</td></tr>
              <tr><td>SMA 50</td><td style={{ textAlign: 'right' }}>${fmt(md?.sma_50)}</td></tr>
              <tr><td>SMA 200</td><td style={{ textAlign: 'right' }}>${fmt(md?.sma_200)}</td></tr>
              <tr><td>ATR</td><td style={{ textAlign: 'right' }}>{fmt(md?.atr, 4)} ({fmt(md?.atr_percent)}%)</td></tr>
              <tr><td>BB Width</td><td style={{ textAlign: 'right' }}>{fmt(md?.bb_width, 4)}</td></tr>
              <tr><td>Volume Ratio</td><td style={{ textAlign: 'right' }}>{fmt(md?.volume_ratio)}x</td></tr>
              <tr><td>OBV Trend</td><td style={{ textAlign: 'right' }}>{md?.obv_trend ? '🟢 Bullish' : '🔴 Bearish'}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="glass-card" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>Macro Context</div>
          <table className="data-table" style={{ width: '100%', fontSize: 'var(--text-xs)' }}>
            <thead><tr><th style={{ textAlign: 'left', paddingBottom: '8px' }}>Metric</th><th style={{ textAlign: 'right', paddingBottom: '8px' }}>Value</th></tr></thead>
            <tbody>
              <tr><td>Market Regime</td><td style={{ textAlign: 'right' }}><span className={`badge ${macro?.market_regime?.toLowerCase().includes('bull') ? 'badge-bull' : macro?.market_regime?.toLowerCase().includes('bear') ? 'badge-bear' : 'badge-neutral'}`}>{macro?.market_regime ?? '—'}</span></td></tr>
              <tr><td>Risk Sentiment</td><td style={{ textAlign: 'right' }}><span className={`badge ${macro?.risk_sentiment === 'RISK_ON' ? 'badge-bull' : macro?.risk_sentiment === 'RISK_OFF' ? 'badge-bear' : 'badge-neutral'}`}>{macro?.risk_sentiment ?? '—'}</span></td></tr>
              <tr><td>SPY Correlation</td><td style={{ textAlign: 'right' }}>{macro?.sp500_correlation ?? '—'}</td></tr>
              <tr><td>NASDAQ Correlation</td><td style={{ textAlign: 'right' }}>{macro?.nasdaq_correlation ?? '—'}</td></tr>
              <tr><td>VIX Level</td><td style={{ textAlign: 'right' }} className={(macro?.vix_level ?? 0) > 25 ? 'table-cell-negative' : 'table-cell-positive'}>{fmt(macro?.vix_level)}</td></tr>
              <tr><td>10Y Yield</td><td style={{ textAlign: 'right' }}>{fmt(macro?.tnx_yield)}%</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <div className="glass-card" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>Chart Patterns</div>
          {cp?.patterns?.length > 0 ? (
            <div className="flex-col gap-2">
              {cp.patterns.map((p: string, i: number) => (
                <div key={i} className="flex-row justify-between items-center" style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--border-glass)' }}>
                  <span style={{ fontSize: '13px' }}>{p}</span>
                  <span className={`badge ${
                    cp.pattern_confidence?.[i] === 'HIGH' ? 'badge-high' :
                    cp.pattern_confidence?.[i] === 'MEDIUM' ? 'badge-medium' : 'badge-low'
                  }`}>{cp.pattern_confidence?.[i] ?? '—'}</span>
                </div>
              ))}
              <div style={{ padding: 'var(--space-2) 0', fontSize: '13px', marginTop: 'var(--space-2)' }}>
                <strong>Fibonacci:</strong> {cp.fibonacci_position || 'N/A'}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No significant patterns detected.</div>
          )}
        </div>

        <div className="glass-card" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>Sentiment</div>
          <table className="data-table" style={{ width: '100%', fontSize: 'var(--text-xs)' }}>
            <thead><tr><th style={{ textAlign: 'left', paddingBottom: '8px' }}>Signal</th><th style={{ textAlign: 'right', paddingBottom: '8px' }}>Value</th></tr></thead>
            <tbody>
              <tr>
                <td>Fear & Greed</td>
                <td style={{ textAlign: 'right' }}>{sent?.fear_greed?.value ?? '—'} ({sent?.fear_greed?.label ?? '—'})</td>
              </tr>
              <tr>
                <td>StockTwits</td>
                <td style={{ textAlign: 'right' }}>{sent?.stocktwits_data?.bull_ratio != null ? `${sent.stocktwits_data.bull_ratio.toFixed(0)}% bullish` : '—'}</td>
              </tr>
              <tr>
                <td>Reddit</td>
                <td style={{ textAlign: 'right' }}><span className="badge badge-violet">{sent?.social_buzz?.length ?? 0} sources</span></td>
              </tr>
              <tr>
                <td>Overall</td>
                <td style={{ textAlign: 'right' }}>
                  {sent?.summary?.overall_signals?.map((s: string, i: number) => (
                    <span key={i} className={`badge ${
                      s.includes('BULL') ? 'badge-bull' :
                      s.includes('BEAR') ? 'badge-bear' :
                      s.includes('FEAR') ? 'badge-bear' :
                      s.includes('GREED') ? 'badge-warning' : 'badge-neutral'
                    }`} style={{ marginLeft: '4px', fontSize: '10px' }}>{s}</span>
                  )) ?? '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
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
