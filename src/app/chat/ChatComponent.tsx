'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import { IntradayCard, LongtermCard, NewsIntelCard } from './AnalysisCards';
import { ThoughtAccordion } from '../components/ui/ThoughtAccordion';
import { getEffort, getThinkingEnabled } from '../../shared/chat-options';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  data?: any;
  type?: 'intraday' | 'longterm' | 'newsintel' | 'chat';
  thoughts?: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

function formatContent(content: string): string {
  try {
    const rawHtml = marked.parse(content, { breaks: true, async: false }) as string;
    return DOMPurify.sanitize(rawHtml);
  } catch (e) {
    return DOMPurify.sanitize(content);
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
  const [streamingThoughts, setStreamingThoughts] = useState<string[]>([]);
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

  const formatIntradayMarkdown = (ticker: string, data: any): string => {
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

    return markdown;
  };

  const formatLongtermMarkdown = (ticker: string, data: any): string => {
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

    return markdown;
  };

  const formatNewsIntelMarkdown = (data: any): string => {
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

    return markdown;
  };

  const executeIntradayCommand = async (ticker: string, updatedMessages: ChatMessage[]): Promise<ChatMessage> => {
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

    const markdown = formatIntradayMarkdown(ticker, data);
    const intradayThoughts = data.verdict?.thoughts || data.verdict?.reasons || (data.verdict?.thought ? [data.verdict.thought] : []);
    return { role: 'assistant', content: markdown, data, type: 'intraday', thoughts: intradayThoughts };
  };

  const executeLongtermCommand = async (ticker: string, updatedMessages: ChatMessage[]): Promise<ChatMessage> => {
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

    const markdown = formatLongtermMarkdown(ticker, data);
    const longtermThoughts = data.verdict?.thoughts || data.verdict?.reasons || (data.verdict?.thought ? [data.verdict.thought] : []);
    return { role: 'assistant', content: markdown, data, type: 'longterm', thoughts: longtermThoughts };
  };

  const executeNewsIntelCommand = async (): Promise<ChatMessage> => {
    const res = await fetch('/api/news-intel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('News intel failed');
    const data = await res.json();
    
    const markdown = formatNewsIntelMarkdown(data);
    const newsThoughts = data.thoughts || data.sentiment?.summary?.overall_signals || [];
    return { role: 'assistant', content: markdown, data, type: 'newsintel', thoughts: newsThoughts };
  };

  const executeStreamChat = async (command: string, updatedMessages: ChatMessage[]): Promise<ChatMessage> => {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: command,
        history: updatedMessages,
        effort: getEffort(),
        thinking: getThinkingEnabled(),
      }),
    });

    if (!res.ok) throw new Error('Failed to start stream');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No readable stream');

    let accumulatedContent = '';
    let accumulatedThoughts: string[] = [];
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
            let token: any = dataStr;
            try { token = JSON.parse(dataStr); } catch {}
            
            if (typeof token === 'string') {
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
              accumulatedThoughts.push(`tool used: ${data.tool}`);
              setStreamingThoughts([...accumulatedThoughts]);
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
              const toolLabel = data.tool;
              const resultText = data.fact ? ` — ${data.fact.substring(0, 140)}${data.fact.length > 140 ? '…' : ''}` : '';
              const marker = `tool used: ${toolLabel}`;
              const idx = accumulatedThoughts.findIndex(t => t.startsWith(marker));
              if (idx !== -1) {
                accumulatedThoughts[idx] = `${marker}${resultText}`;
              } else {
                accumulatedThoughts.push(`${marker}${resultText}`);
              }
              setStreamingThoughts([...accumulatedThoughts]);
            } catch (e) {}
          } else if (currentEvent === 'thought_new') {
            try {
              let data = JSON.parse(dataStr);
              if (typeof data !== 'string') {
                data = typeof data === 'object' && data.text ? data.text : JSON.stringify(data);
              }
              accumulatedThoughts.push(data);
              setStreamingThoughts([...accumulatedThoughts]);
            } catch {
              accumulatedThoughts.push(dataStr);
              setStreamingThoughts([...accumulatedThoughts]);
            }
          } else if (currentEvent === 'thought') {
            try {
              let data = JSON.parse(dataStr);
              if (typeof data !== 'string') {
                data = typeof data === 'object' && data.text ? data.text : JSON.stringify(data);
              }
              
              if (accumulatedThoughts.length === 0) {
                accumulatedThoughts = [data];
              } else {
                accumulatedThoughts[accumulatedThoughts.length - 1] += data;
              }
              setStreamingThoughts([...accumulatedThoughts]);
            } catch (e) {
              if (accumulatedThoughts.length === 0) {
                accumulatedThoughts = [dataStr];
              } else {
                accumulatedThoughts[accumulatedThoughts.length - 1] += dataStr;
              }
              setStreamingThoughts([...accumulatedThoughts]);
            }
          } else if (currentEvent === 'error') {
            throw new Error(JSON.parse(dataStr).message || 'Stream error');
          }
        }
      }
    }
    
    return {
      role: 'assistant',
      content: accumulatedContent || 'No response received.',
      thoughts: accumulatedThoughts.length > 0 ? [...accumulatedThoughts] : undefined,
    };
  };

  const sendMessage = async (override?: string) => {
    if (loading) return;
    if (!override && !input.trim()) return;

    const command = (override ?? input).trim();
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
    } else {
      saveSession(activeChatId, updatedMessages);
    }

    try {
      let reply: ChatMessage;
      const lower = command.toLowerCase();

      if (lower.startsWith('/intraday ')) {
        const ticker = command.substring(10).trim();
        reply = await executeIntradayCommand(ticker, updatedMessages);
      } else if (lower.startsWith('/longterm ')) {
        const ticker = command.substring(10).trim();
        reply = await executeLongtermCommand(ticker, updatedMessages);
      } else if (lower === '/newsintel') {
        reply = await executeNewsIntelCommand();
      } else {
        reply = await executeStreamChat(command, updatedMessages);
      }

      const finalMessages = [...updatedMessages, reply];
      setMessages(finalMessages);
      setStreamingContent('');
      setStreamingThoughts([]);
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
      if (chatId !== activeChatId) {
        router.replace('/chat/' + activeChatId);
      }
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
              <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
                  <img src="/logo-boz-solid.png" alt="BOZ" style={{ width: 80, height: 80, objectFit: 'contain' }} />
                </div>
                <h2 style={{ fontSize: '28px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>How can I help you today?</h2>
                <p style={{ fontSize: '15px', color: 'var(--text-muted)', marginBottom: '40px', maxWidth: '400px', textAlign: 'center' }}>
                  Analyze markets, lookup stocks, or generate trading strategies.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '560px' }}>
                  {[
                    { text: 'What is the current market outlook?', action: 'What is the current market outlook?' },
                    { text: 'Intraday analysis (NVDA)', action: '/intraday NVDA' },
                    { text: 'News Intel', action: '/newsintel' },
                    { text: 'Longterm outlook (AAPL)', action: '/longterm AAPL' },
                  ].map((s, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(s.action)}
                      className="suggestion-chip"
                    >
                      {s.text}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`chat-bubble ${msg.role}`}>
                    {msg.role === 'assistant' ? (
                      <div className="flex-row gap-3">
                        <div style={{ flexShrink: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <img src="/logo-boz-solid.png" alt="BOZ" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: '12px' }} />
                        </div>
                        <div style={{ width: '100%', paddingTop: '4px' }}>
                          {msg.type === 'intraday' && <IntradayCard data={msg.data} />}
                          {msg.type === 'longterm' && <LongtermCard data={msg.data} />}
                          {msg.type === 'newsintel' && <NewsIntelCard data={msg.data} />}
                          {/* Analysis cards already render their own CoT — skip duplicate for those types */}
                          {msg.thoughts && msg.thoughts.length > 0 && msg.type !== 'intraday' && msg.type !== 'longterm' && msg.type !== 'newsintel' && (
                            <ThoughtAccordion
                              thoughts={msg.thoughts}
                              title="AI Thinking Process"
                              defaultOpen={false}
                            />
                          )}
                          <div dangerouslySetInnerHTML={{ __html: formatContent(msg.content) }} />
                        </div>
                      </div>
                    ) : (
                      <span>{msg.content}</span>
                    )}
                  </div>
                ))}

                {/* Loading indicator — streaming assistant response */}
                {loading && (
                  <div className={`chat-bubble assistant`}>
                    <div className="flex-row gap-3">
                      <div style={{ flexShrink: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src="/logo-boz-solid.png" alt="BOZ" style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: '12px' }} />
                      </div>
                      <div style={{ width: '100%', paddingTop: '4px' }}>
                        {streamingThoughts.length > 0 && (
                          <ThoughtAccordion
                            thoughts={streamingThoughts}
                            isStreaming={true}
                            defaultOpen={true}
                            title="Live AI Thinking Process"
                          />
                        )}
                        {streamingContent ? (
                          <div dangerouslySetInnerHTML={{ __html: formatContent(streamingContent) }} />
                        ) : streamingThoughts.length > 0 ? null : (
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
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input Area */}
          <div className="chat-input-area">
            {input.startsWith('/') && !input.includes(' ') && input !== '/newsintel' && (
              <div style={{
                position: 'absolute',
                bottom: 'calc(100% - 1px)',
                left: '32px',
                width: '300px',
                background: 'rgba(18, 18, 18, 0.95)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderBottom: 'none',
                borderRadius: '16px 16px 0 0',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                boxShadow: '0 -10px 40px -10px rgba(0,0,0,0.8)',
                zIndex: 10,
              }}>
                <div style={{ padding: '8px 12px 4px 12px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Slash Commands</div>
                
                {[
                  { cmd: '/intraday ', title: '/intraday [ticker]', desc: 'Live intraday analysis & key levels' },
                  { cmd: '/longterm ', title: '/longterm [ticker]', desc: 'Fundamental analysis & long-term outlook' },
                  { cmd: '/newsintel', title: '/newsintel', desc: 'Scan latest market headlines' }
                ].filter(c => c.cmd.startsWith(input) || c.title.startsWith(input)).map(item => (
                  <button 
                    key={item.cmd}
                    onClick={() => { setInput(item.cmd); inputRef.current?.focus(); }}
                    style={{ display: 'flex', flexDirection: 'column', padding: '10px 12px', background: 'transparent', border: 'none', borderRadius: '10px', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', transition: 'background 0.2s' }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{item.title}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.desc}</div>
                  </button>
                ))}
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              className="input"
              placeholder="Ask anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              className="chat-input-btn"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
            >
              {loading ? (
                <i className="fa-solid fa-stop" style={{ fontSize: '14px' }}></i>
              ) : (
                <i className="fa-solid fa-arrow-up" style={{ fontSize: '16px' }}></i>
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
