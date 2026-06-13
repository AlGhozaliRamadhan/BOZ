'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { marked } from 'marked';
import { IntradayCard, LongtermCard, NewsIntelCard } from './AnalysisCards';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  data?: any;
  type?: 'intraday' | 'longterm' | 'newsintel' | 'chat';
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

function formatContent(content: string): string {
  try {
    return marked.parse(content, { breaks: true, async: false }) as string;
  } catch (e) {
    return content;
  }
}

export default function ChatComponent({ chatId }: { chatId?: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [loadingType, setLoadingType] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [toolStatuses, setToolStatuses] = useState<Array<{tool: string, status: 'running' | 'done', result?: string}>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadingMessages = [
    "Fetching real-time market data...",
    "Scanning social sentiment on Reddit and StockTwits...",
    "Calculating technical indicators and moving averages...",
    "Analyzing macro environment and Treasury yields...",
    "Waiting for AI models to synthesize response...",
    "Finalizing trading strategy..."
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading && loadingType && (loadingType.startsWith('/intraday') || loadingType.startsWith('/longterm'))) {
      interval = setInterval(() => {
        setLoadingStep((prev) => Math.min(prev + 1, loadingMessages.length - 1));
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [loading, loadingType]);

  useEffect(() => {
    if (chatId) {
      const stored = localStorage.getItem('boz_chat_sessions');
      if (stored) {
        try {
          const sessions: ChatSession[] = JSON.parse(stored);
          const session = sessions.find(s => s.id === chatId);
          if (session) {
            setMessages(session.messages);
          }
        } catch (e) {
          console.error('Failed to load chat session', e);
        }
      }
    }
  }, [chatId]);

  const saveSession = (id: string, msgs: ChatMessage[]) => {
    try {
      const stored = localStorage.getItem('boz_chat_sessions');
      let sessions: ChatSession[] = stored ? JSON.parse(stored) : [];
      const index = sessions.findIndex(s => s.id === id);
      
      const title = msgs.find(m => m.role === 'user')?.content.substring(0, 30) + '...' || 'New Chat';
      
      if (index >= 0) {
        sessions[index].messages = msgs;
        sessions[index].updatedAt = Date.now();
      } else {
        sessions.push({ id, title, messages: msgs, updatedAt: Date.now() });
      }
      localStorage.setItem('boz_chat_sessions', JSON.stringify(sessions));
      // Dispatch an event so sidebar can update
      window.dispatchEvent(new Event('boz_chat_updated'));
    } catch (e) {
      console.error('Failed to save session', e);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const command = input.trim();
    const userMessage: ChatMessage = { role: 'user', content: command };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);
    setLoadingStep(0);
    setLoadingType(command.toLowerCase());
    setError(null);

    let activeChatId = chatId;
    if (!activeChatId) {
      activeChatId = btoa(Date.now().toString() + Math.random().toString(36).substring(7)).replace(/=/g, '');
      saveSession(activeChatId, updatedMessages);
      window.history.replaceState(null, '', '/chat/' + activeChatId);
      // Don't return here, we want to continue processing the message
    } else {
      saveSession(activeChatId, updatedMessages);
    }

    try {
      let finalMessages = [...updatedMessages];
      
      if (command.toLowerCase().startsWith('/intraday ')) {
        const ticker = command.substring(10).trim();
        
        // 1. Fetch data
        const dataRes = await fetch('/api/analyze/intraday/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: ticker.toUpperCase() }),
        });
        if (!dataRes.ok) throw new Error('Intraday data fetch failed');
        const data = await dataRes.json();

        // Push intermediate message with data immediately
        const intermediateMessages = [...updatedMessages, { 
          role: 'assistant', 
          content: '*Synthesizing AI verdict...*', 
          data, 
          type: 'intraday' 
        } as ChatMessage];
        setMessages(intermediateMessages);

        // Update loading state for AI reasoning step
        setLoadingType('/intraday-verdict');

        // 2. Fetch AI Verdict
        const verdictRes = await fetch('/api/analyze/intraday/verdict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: ticker.toUpperCase(), ...data }),
        });
        if (!verdictRes.ok) throw new Error('Intraday AI verdict failed');
        const verdictData = await verdictRes.json();

        data.verdict = verdictData.verdict;
        data.tradeLevels = verdictData.tradeLevels;
        
        let markdown = `**Intraday Analysis for ${ticker.toUpperCase()}**\n\n`;
        const v = data.verdict;
        if (v) {
          markdown += `**Verdict:** ${v.status === 'ok' ? (v.prediction === 'UP' ? 'Bullish Outlook 🟢' : 'Bearish Outlook 🔴') : 'Uncertain / Hold ⚪'} (${v.confidence || '--'}% Conviction)\n`;
          markdown += `**Strategy:** ${v.strategy || v.reason || 'N/A'}\n\n`;
        }

        const tl = data.tradeLevels;
        if (tl) {
          markdown += `**Trade Levels:**\n`;
          markdown += `- **Entry:** ${tl.entryRange || '--'}\n`;
          markdown += `- **Target:** ${tl.targetRange || '--'}\n`;
          markdown += `- **Stop Loss:** ${tl.stopLoss || '--'}\n\n`;
        }
        
        const md = data.marketData;
        const macro = data.macro;
        const sent = data.sentiment;

        if (md || macro || sent) {
          markdown += `**Technical & Macro Indicators:**\n\n`;
          if (md) {
            markdown += `- **Technicals:** RSI: ${md.rsi?.toFixed(1) || '--'} | MACD: ${md.macd?.toFixed(4) || '--'} | ATR: ${md.atr?.toFixed(4) || '--'} | SMA20: $${md.sma_20?.toFixed(2) || '--'} | OBV Trend: ${md.obv_trend ? '🟢 Bullish' : '🔴 Bearish'}\n`;
          }
          if (macro) {
            markdown += `- **Macro:** Regime: ${macro.market_regime || '--'} | Risk: ${macro.risk_sentiment || '--'} | VIX: ${macro.vix_level?.toFixed(2) || '--'}\n`;
          }
          if (sent) {
            markdown += `- **Sentiment:** Fear & Greed: ${sent.fear_greed?.value || '--'} (${sent.fear_greed?.label || '--'}) | StockTwits: ${sent.stocktwits_data?.bull_ratio ? sent.stocktwits_data.bull_ratio.toFixed(0) + '% Bullish' : '--'}\n`;
          }
          markdown += `\n`;
        }
        
        if (v && v.reasons && v.reasons.length > 0) {
          markdown += `**AI Reasoning:**\n`;
          v.reasons.forEach((r: string) => {
            markdown += `- ${r}\n`;
          });
        }
        
        finalMessages.push({ role: 'assistant', content: markdown, data, type: 'intraday' });
      } else if (command.toLowerCase().startsWith('/longterm ')) {
        const ticker = command.substring(10).trim();
        
        // 1. Fetch data
        const dataRes = await fetch('/api/analyze/longterm/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: ticker.toUpperCase() }),
        });
        if (!dataRes.ok) throw new Error('Longterm data fetch failed');
        const data = await dataRes.json();

        // Push intermediate message with data immediately
        const intermediateMessages = [...updatedMessages, { 
          role: 'assistant', 
          content: '*Synthesizing AI verdict...*', 
          data, 
          type: 'longterm' 
        } as ChatMessage];
        setMessages(intermediateMessages);

        // Update loading state for AI reasoning step
        setLoadingType('/longterm-verdict');

        // 2. Fetch AI Verdict
        const verdictRes = await fetch('/api/analyze/longterm/verdict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: ticker.toUpperCase(), ...data }),
        });
        if (!verdictRes.ok) throw new Error('Longterm AI verdict failed');
        const verdictData = await verdictRes.json();

        data.verdict = verdictData.verdict;
        data.tradeLevels = verdictData.tradeLevels;
        
        let markdown = `**Long-term Outlook for ${ticker.toUpperCase()}**\n\n`;
        const v = data.verdict;
        if (v) {
          markdown += `**Verdict:** ${v.status === 'ok' ? (v.prediction === 'UP' ? 'Bullish Outlook 🟢' : 'Bearish Outlook 🔴') : 'Uncertain / Hold ⚪'} (${v.confidence || '--'}% Conviction)\n`;
          markdown += `**Strategy:** ${v.strategy || v.reason || 'N/A'}\n\n`;
        }

        const tl = data.tradeLevels;
        if (tl) {
          markdown += `**Trade Levels:**\n`;
          markdown += `- **Entry:** ${tl.entryRange || '--'}\n`;
          markdown += `- **Target:** ${tl.targetRange || '--'}\n`;
          markdown += `- **Stop Loss:** ${tl.stopLoss || '--'}\n\n`;
        }
        
        const md = data.marketData;
        if (md && md.fiftyTwoWeekHigh) {
          markdown += `**52-Week Context:**\n`;
          markdown += `- **High:** $${md.fiftyTwoWeekHigh?.toFixed(2)} (${md.from52wHigh?.toFixed(1)}%) | **Low:** $${md.fiftyTwoWeekLow?.toFixed(2)} (+${md.from52wLow?.toFixed(1)}%)\n\n`;
        }
        
        const macro = data.macro;
        if (macro) {
          markdown += `**Macro Context:**\n`;
          markdown += `- **Regime:** ${macro.market_regime || '--'} | **10Y Yield:** ${macro.tnx_yield ? macro.tnx_yield + '%' : '--'} | **SPY Corr:** ${macro.sp500_correlation || '--'}\n\n`;
        }
        if (v && v.reasons && v.reasons.length > 0) {
          markdown += `**AI Reasoning:**\n`;
          v.reasons.forEach((r: string) => {
            markdown += `- ${r}\n`;
          });
        }

        finalMessages.push({ role: 'assistant', content: markdown, data, type: 'longterm' });
      } else if (command.toLowerCase() === '/newsintel') {
        const res = await fetch('/api/news-intel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) throw new Error('News intel failed');
        const data = await res.json();
        
        let markdown = `**Latest Market News Intelligence**\n\n`;
        const sent = data.sentiment;
        if (sent) {
          markdown += `**Market Sentiment Overview:**\n`;
          markdown += `- **Fear & Greed:** ${sent.fear_greed?.value || '--'} (${sent.fear_greed?.label || 'N/A'})\n`;
          if (sent.stocktwits_data?.bull_ratio) markdown += `- **StockTwits Bull %:** ${sent.stocktwits_data.bull_ratio.toFixed(0)}%\n`;
          markdown += `- **Headlines Analyzed:** ${data.totalHeadlines || 0}\n`;
          if (sent.summary?.overall_signals) markdown += `- **Signals:** ${sent.summary.overall_signals.join(' | ')}\n\n`;
        }


        markdown += `**Top Headlines:**\n`;
        const headlines = data.headlines || [];
        headlines.slice(0, 5).forEach((h: any) => {
          markdown += `- **[${h.source}]** ${h.title} *(Sentiment: ${h.sentiment})*\n`;
        });

        finalMessages.push({ role: 'assistant', content: markdown, data, type: 'newsintel' });
      } else {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: command,
            history: updatedMessages,
          }),
        });

        if (!res.ok) throw new Error('Failed to start stream');
        const reader = res.body?.getReader();
        if (!reader) throw new Error('No readable stream');

        let accumulatedContent = '';
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.substring(7).trim();
            } else if (line.startsWith('data: ')) {
              const dataStr = line.substring(6).trim();
              if (!dataStr) continue;

              if (currentEvent === 'token') {
                // Since SSE often encodes newlines in JSON or escapes them, we must handle it.
                // In our implementation, if data is string, it's sent as `data: text` directly.
                let token = dataStr;
                try { token = JSON.parse(dataStr); } catch {} // just in case it was JSON-stringified
                
                // If the engine emits real newlines, SSE requires data: on each line or \n encoding.
                // Our simple SSE token format encodes it as JSON or plain string.
                if (typeof token === 'string') {
                  // Reconstruct newlines if it was replaced (e.g. JSON stringify handles \n)
                  accumulatedContent += token.replace(/\\n/g, '\n');
                } else if (token && typeof token === 'object' && token.message) {
                  accumulatedContent += token.message;
                } else {
                  accumulatedContent += String(token);
                }
                setStreamingContent(accumulatedContent);
              } else if (currentEvent === 'tool_start') {
                try {
                  const data = JSON.parse(dataStr);
                  setToolStatuses(prev => [...prev, { tool: data.tool, status: 'running' }]);
                } catch (e) {}
              } else if (currentEvent === 'tool_result') {
                try {
                  const data = JSON.parse(dataStr);
                  setToolStatuses(prev => {
                    const next = [...prev];
                    const idx = next.findIndex(t => t.tool === data.tool && t.status === 'running');
                    if (idx !== -1) {
                      next[idx] = { ...next[idx], status: 'done', result: data.fact };
                    } else {
                      next.push({ tool: data.tool, status: 'done', result: data.fact });
                    }
                    return next;
                  });
                } catch (e) {}
              } else if (currentEvent === 'error') {
                throw new Error(JSON.parse(dataStr).message || 'Stream error');
              }
            }
          }
        }
        
        finalMessages.push({
          role: 'assistant',
          content: accumulatedContent || 'No response received.',
        });
      }

      setMessages(finalMessages);
      setStreamingContent('');
      setToolStatuses([]);
      saveSession(activeChatId, finalMessages);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      const errMessages = [
        ...updatedMessages,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error processing your request. Please try again.',
        } as ChatMessage,
      ];
      setMessages(errMessages);
      setStreamingContent('');
      setToolStatuses([]);
      saveSession(activeChatId, errMessages);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };



  return (
    <div className="animate-fadeIn">
      {/* Header */}


      {/* Chat Container */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="chat-container">
          {/* Messages */}
          <div className="chat-messages">
            {messages.length === 0 && !loading ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h3 className="empty-state-title">Start a conversation with BOZ</h3>
                <p className="empty-state-text">
                  Ask about market analysis, technical indicators, trading strategies, or any financial question.
                </p>
                <div className="grid-2 gap-3" style={{ marginTop: 'var(--space-4)', maxWidth: '500px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setInput('What is the current market outlook?'); }}
                  >
                    Market outlook
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setInput('/intraday NVDA'); }}
                  >
                    /intraday NVDA
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setInput('/newsintel'); }}
                  >
                    /newsintel
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setInput('/longterm AAPL'); }}
                  >
                    /longterm AAPL
                  </button>
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`chat-bubble ${msg.role}`}>
                    {msg.role === 'assistant' ? (
                      <div className="flex-row gap-3">
                        <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 'var(--radius-sm)', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--bg-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                          </svg>
                        </div>
                        <div style={{ width: '100%' }}>
                          {msg.type === 'intraday' && <IntradayCard data={msg.data} />}
                          {msg.type === 'longterm' && <LongtermCard data={msg.data} />}
                          {msg.type === 'newsintel' && <NewsIntelCard data={msg.data} />}
                          <div dangerouslySetInnerHTML={{ __html: formatContent(msg.content) }} />
                        </div>
                      </div>
                    ) : (
                      <span>{msg.content}</span>
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {loading && (
                  <div style={{ display: 'flex', flexDirection: 'row', gap: '12px', alignItems: 'flex-start', padding: '12px 0' }}>
                    <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 'var(--radius-sm)', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '4px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--bg-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    </div>
                    <div style={{ width: '100%' }}>
                      {toolStatuses.length > 0 && (
                        <div className="flex-col gap-2 mb-3 mt-1" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          {toolStatuses.map((ts, idx) => (
                            <div key={idx} className="flex-row items-center gap-2">
                              {ts.status === 'running' ? (
                                <span className="spinner spinner-sm"></span>
                              ) : (
                                <span>✅</span>
                              )}
                              <span>Using tool: <strong style={{ color: 'var(--text-primary)' }}>{ts.tool}</strong></span>
                              {ts.result && <span style={{ opacity: 0.8 }}>— {ts.result.substring(0, 80)}{ts.result.length > 80 ? '...' : ''}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {streamingContent ? (
                        <div dangerouslySetInnerHTML={{ __html: formatContent(streamingContent) }} />
                      ) : (
                        <div className="flex-row gap-2 items-center" style={{ height: '28px' }}>
                          {!toolStatuses.length && <span className="spinner spinner-sm"></span>}
                          <span className="page-subtitle animate-fadeIn" key={loadingStep} style={{ margin: 0, transition: 'all 0.3s ease' }}>
                            {(loadingType?.startsWith('/intraday') || loadingType?.startsWith('/longterm'))
                              ? loadingMessages[loadingStep]
                              : toolStatuses.length ? 'Analyzing data...' : 'Thinking...'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input Area */}
          <div className="chat-input-area">
            <input
              ref={inputRef}
              type="text"
              className="input"
              placeholder="Ask BOZ anything about markets..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              className="btn btn-primary"
              onClick={sendMessage}
              disabled={loading || !input.trim()}
            >
              {loading ? (
                <span className="spinner spinner-sm"></span>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="toast-container">
          <div className="toast error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
