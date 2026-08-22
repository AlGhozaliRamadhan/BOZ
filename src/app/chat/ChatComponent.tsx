'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';
import { ThoughtAccordion } from '../components/ui/ThoughtAccordion';
import { getEffort, getThinkingEnabled } from '../../shared/chat-options';
import ChatModelPicker from './ChatModelPicker';
import type { ToolResult } from './ToolResultCards';

export interface TickerSuggestion {
  symbol: string;
  name: string;
  exchange?: string;
  command?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  data?: any;
  type?: 'intraday' | 'longterm' | 'newsintel' | 'chat';
  thoughts?: string[];
  tools?: ToolResult[];
  suggestions?: TickerSuggestion[];
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

interface MarketQuote {
  text: string;
  author: string;
}

const MARKET_QUOTES: MarketQuote[] = [
  { text: "Risk comes from not knowing what you are doing.", author: "Warren Buffett" },
  { text: "In trading, you have to be defensive. If you have a bad trade, cut it quickly before it hurts.", author: "Paul Tudor Jones" },
  { text: "The stock market is a device to transfer money from the impatient to the patient.", author: "Benjamin Graham" },
  { text: "It is not whether you are right or wrong, but how much money you make when you are right and how much you lose when you are wrong.", author: "George Soros" },
  { text: "The trend is your friend until the end when it bends.", author: "Ed Seykota" },
  { text: "Markets can remain irrational longer than you can remain solvent.", author: "John Maynard Keynes" },
  { text: "The four most dangerous words in investing are: 'This time it's different.'", author: "Sir John Templeton" },
  { text: "Cut your losses short and let your winners run.", author: "Jesse Livermore" },
  { text: "The goal of a successful trader is to make the best trades. Money is secondary.", author: "Alexander Elder" },
  { text: "Rule No. 1: Never lose money. Rule No. 2: Never forget rule No. 1.", author: "Warren Buffett" },
  { text: "In investing, what is comfortable is rarely profitable.", author: "Robert Arnott" },
  { text: "Know what you own, and know why you own it.", author: "Peter Lynch" },
  { text: "The elements of good trading are: 1. Cutting losses, 2. Cutting losses, and 3. Cutting losses.", author: "Ed Seykota" },
  { text: "The stock market does not know you own it.", author: "Warren Buffett" },
  { text: "Win or lose, everybody gets what they want out of the market.", author: "Ed Seykota" },
  { text: "If you cannot control your emotions, you cannot control your money.", author: "Warren Buffett" },
  { text: "Price is what you pay. Value is what you get.", author: "Warren Buffett" },
  { text: "Wide diversification is only required when investors do not understand what they are doing.", author: "Warren Buffett" },
  { text: "Opportunities come infrequently. When it rains gold, put out the bucket, not the thimble.", author: "Warren Buffett" },
  { text: "The big money is not in the buying and the selling, but in the waiting.", author: "Charlie Munger" },
  { text: "It is remarkable how much long-term advantage people like us have gotten by trying to be consistently not stupid, instead of trying to be very intelligent.", author: "Charlie Munger" },
  { text: "In the short run, the market is a voting machine, but in the long run, it is a weighing machine.", author: "Benjamin Graham" },
  { text: "Behind every stock is a company. Find out what it's doing.", author: "Peter Lynch" },
  { text: "Go for a business that any idiot can run — because sooner or later, any idiot probably is going to run it.", author: "Peter Lynch" },
  { text: "You get recessions, you have stock market declines. If you don't understand that's going to happen, then you're not ready, you won't do well in the markets.", author: "Peter Lynch" },
  { text: "Losers average losers.", author: "Paul Tudor Jones" },
  { text: "I'm always thinking about losing money as opposed to making money. Don't focus on making money, focus on protecting what you have.", author: "Paul Tudor Jones" },
  { text: "Markets are constantly in a state of uncertainty and flux, and money is made by discounting the obvious and betting on the unexpected.", author: "George Soros" },
  { text: "There is nothing new in Wall Street. Whatever happens in the stock market today has happened before and will happen again.", author: "Jesse Livermore" },
  { text: "It was never my thinking that made the big money for me. It also was my sitting. Got that? My sitting tight!", author: "Jesse Livermore" },
  { text: "A loss never bothers me after I take it. I forget it overnight. But being wrong — not taking the loss — that is what does the damage to the pocketbook and to the soul.", author: "Jesse Livermore" },
  { text: "If you don't find a way to make money while you sleep, you will work until you die.", author: "Warren Buffett" },
  { text: "The desire for constant action irrespective of underlying conditions is responsible for many losses on Wall Street.", author: "Jesse Livermore" },
  { text: "I just wait until there is money lying in the corner, and all I have to do is go over there and pick it up. I do nothing in the meantime.", author: "Jim Rogers" },
  { text: "Do not anticipate and move without market confirmation — being a little late in your trade is your insurance that your judgment is correct.", author: "Jesse Livermore" },
  { text: "The market is a harsh teacher because she gives the test first, the lesson afterward.", author: "Vernon Law" },
  { text: "The secret to being successful from a trading perspective is to have an indefatigable and undying and unquenchable thirst for information and knowledge.", author: "Paul Tudor Jones" },
  { text: "Investing should be more like watching paint dry or watching grass grow. If you want excitement, take $800 and go to Las Vegas.", author: "Paul Samuelson" },
  { text: "The individual investor should act consistently as an investor and not as a speculator.", author: "Benjamin Graham" },
  { text: "Bull markets are born on pessimism, grow on skepticism, mature on optimism and die on euphoria.", author: "Sir John Templeton" },
  { text: "The most important quality for an investor is temperament, not intellect.", author: "Warren Buffett" },
  { text: "If you are shopping for common stocks, chose them the way you would buy groceries, not the way you would buy perfume.", author: "Benjamin Graham" },
  { text: "All you need is one good idea to make a lot of money.", author: "Charlie Munger" },
  { text: "It takes 20 years to build a reputation and five minutes to ruin it. If you think about that, you'll do things differently.", author: "Warren Buffett" },
  { text: "I have two basic rules about winning in trading as well as in life: 1. If you don't bet, you can't win. 2. If you lose all your chips, you can't bet.", author: "Larry Hite" },
  { text: "Whenever I get hit in the market, I get the hell out. It doesn't matter where the market is trading.", author: "Marty Schwartz" },
  { text: "Learn to take losses. The most important thing in making money is not letting your losses get out of hand.", author: "Marty Schwartz" },
  { text: "I always define my risk, and I don't have to worry about it.", author: "Tony Saliba" },
  { text: "The key to trading success is emotional discipline. If intelligence were the key, there would be a lot more people making money.", author: "Victor Sperandeo" },
  { text: "Amateurs think about how much money they can make. Professionals think about how much money they could lose.", author: "Mark Douglas" },
  { text: "When you genuinely accept the risks, you will be at peace with any outcome.", author: "Mark Douglas" },
  { text: "The market does not know you exist. You can do nothing to influence it. You can only control your behavior.", author: "Mark Douglas" },
  { text: "I believe in both technical analysis and fundamentals. But the charts tell the story before the fundamentals do.", author: "Dan Zanger" },
  { text: "The whole secret to winning in the stock market is to lose the least amount possible when you're not right.", author: "William O'Neil" },
  { text: "Letting your losses run is the most serious mistake made by most investors.", author: "William O'Neil" },
  { text: "It is crucial to have a plan for selling before you buy.", author: "Mark Minervini" },
  { text: "Expectancy is everything: win rate multiplied by average win minus loss rate multiplied by average loss.", author: "Mark Minervini" },
  { text: "Discipline is the bridge between goals and accomplishment.", author: "Jim Rohn" },
  { text: "Compound interest is the eighth wonder of the world. He who understands it, earns it; he who doesn't, pays it.", author: "Albert Einstein" },
  { text: "Spend each day trying to be a little wiser than you were when you woke up.", author: "Charlie Munger" }
];

const getRandomGreeting = (): string => {
  const hour = new Date().getHours();
  
  if (hour >= 5 && hour < 12) {
    const morning = [
      'Good morning, User',
      'Ready for the opening bell?',
      'Rise and analyze, User',
      'Good morning! Let\'s check the tape'
    ];
    return morning[Math.floor(Math.random() * morning.length)];
  } else if (hour >= 12 && hour < 17) {
    const noon = [
      'Good afternoon, User',
      'Midday market check-in',
      'Active session underway, User',
      'Good afternoon! What are we scanning?'
    ];
    return noon[Math.floor(Math.random() * noon.length)];
  } else if (hour >= 17 && hour < 22) {
    const evening = [
      'Good evening, User',
      'Evening debrief & analysis',
      'Good evening! Reviewing today\'s action',
      'Market wrap & research session'
    ];
    return evening[Math.floor(Math.random() * evening.length)];
  } else {
    const night = [
      'Burning the midnight oil?',
      'Late night research mode, User',
      'Good night, User',
      'Overnight global market scan'
    ];
    return night[Math.floor(Math.random() * night.length)];
  }
};

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
  const [toolStatuses, setToolStatuses] = useState<ToolResult[]>([]);
  const [activeModel, setActiveModel] = useState('');
  const [greeting, setGreeting] = useState('How can I help you today?');
  const [currentQuote, setCurrentQuote] = useState<MarketQuote | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setGreeting(getRandomGreeting());
    setCurrentQuote(MARKET_QUOTES[Math.floor(Math.random() * MARKET_QUOTES.length)]);
  }, []);

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
    } else {
      setMessages([]);
      setStreamingContent('');
      setStreamingThoughts([]);
      setToolStatuses([]);
    }
  }, [chatId]);

  useEffect(() => {
    const handleNewChat = () => {
      setMessages([]);
      setStreamingContent('');
      setStreamingThoughts([]);
      setToolStatuses([]);
      setError(null);
      setInput('');
      setGreeting(getRandomGreeting());
      setCurrentQuote(MARKET_QUOTES[Math.floor(Math.random() * MARKET_QUOTES.length)]);
      textareaRef.current?.focus();
    };
    window.addEventListener('boz_new_chat', handleNewChat);
    return () => window.removeEventListener('boz_new_chat', handleNewChat);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

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
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const loadModel = async () => {
      try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        setActiveModel(data.model || '');
      } catch {
        // keep last known model
      }
    };
    loadModel();
    window.addEventListener('boz_settings_updated', loadModel);
    return () => window.removeEventListener('boz_settings_updated', loadModel);
  }, []);

  const executeStreamChat = async (command: string, updatedMessages: ChatMessage[]): Promise<ChatMessage> => {
    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: command,
        history: updatedMessages.map(({ role, content }) => ({ role, content })),
        effort: getEffort(),
        thinking: getThinkingEnabled(),
        model: activeModel || undefined,
      }),
    });

    if (!res.ok) throw new Error('Failed to start stream');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No readable stream');

    let accumulatedContent = '';
    let accumulatedThoughts: string[] = [];
    const collectedTools: ToolResult[] = [];
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
              collectedTools.push({ tool: data.tool, status: 'running', args: data.args });
              setToolStatuses([...collectedTools]);
              const toolArgStr = data.args && Object.keys(data.args).length > 0 ? ` (${Object.values(data.args).join(', ')})` : '';
              accumulatedThoughts.push(`tool used: ${data.tool}${toolArgStr}`);
              setStreamingThoughts([...accumulatedThoughts]);
            } catch (e) {}
          } else if (currentEvent === 'tool_result') {
            try {
              const data = JSON.parse(dataStr);
              const idx = collectedTools.findIndex(t => t.tool === data.tool && t.status === 'running');
              const next: ToolResult = {
                tool: data.tool,
                status: 'done',
                fact: data.fact,
                quality: data.quality,
                success: data.success,
                preview: data.preview,
                args: data.args ?? (idx !== -1 ? collectedTools[idx].args : undefined),
              };
              if (idx !== -1) collectedTools[idx] = next;
              else collectedTools.push(next);
              setToolStatuses([...collectedTools]);
              const toolLabel = data.tool;
              const toolArgStr = data.args && Object.keys(data.args).length > 0 ? ` (${Object.values(data.args).join(', ')})` : '';
              const resultText = data.fact ? ` — ${data.fact.substring(0, 140)}${data.fact.length > 140 ? '…' : ''}` : '';
              const marker = `tool used: ${toolLabel}`;
              const thoughtIdx = accumulatedThoughts.findIndex(t => t.startsWith(marker));
              if (thoughtIdx !== -1) {
                accumulatedThoughts[thoughtIdx] = `${marker}${toolArgStr}${resultText}`;
              } else {
                accumulatedThoughts.push(`${marker}${toolArgStr}${resultText}`);
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
            let dataText = dataStr;
            try {
              let parsed = JSON.parse(dataStr);
              if (typeof parsed !== 'string') {
                parsed = typeof parsed === 'object' && parsed.text ? parsed.text : JSON.stringify(parsed);
              }
              dataText = parsed;
            } catch {}

            const lastIdx = accumulatedThoughts.length - 1;
            const lastItem = lastIdx >= 0 ? accumulatedThoughts[lastIdx] : null;
            const isLastItemToolOrHeader = lastItem && (
              lastItem.startsWith('tool used: ') ||
              lastItem.startsWith('• tool_call: ') ||
              lastItem.startsWith('Searched: ') ||
              lastItem.startsWith('Branching off:') ||
              lastItem.startsWith('Branches are in') ||
              lastItem.startsWith('Before answering')
            );

            if (accumulatedThoughts.length === 0 || isLastItemToolOrHeader) {
              accumulatedThoughts.push(dataText);
            } else {
              accumulatedThoughts[lastIdx] += dataText;
            }
            setStreamingThoughts([...accumulatedThoughts]);
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
      tools: collectedTools.filter((t) => t.status === 'done'),
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
      const reply = await executeStreamChat(command, updatedMessages);

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
      setStreamingThoughts([]);
      setToolStatuses([]);
      saveSession(activeChatId, errMessages);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
      if (chatId !== activeChatId) {
        router.replace('/chat/' + activeChatId);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };



  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="chat-page-root animate-fadeIn">
      <div className="chat-container">
        {/* Messages */}
        <div className="chat-messages">
            {messages.length === 0 && !loading ? (
              <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 68, height: 68, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                  <img src="/logo-boz-solid.png" alt="BOZ" style={{ width: 68, height: 68, objectFit: 'contain', borderRadius: '16px' }} />
                </div>
                <h2 className="chat-empty-title">{greeting}</h2>

                {currentQuote && (
                  <div className="chat-empty-quote animate-fadeIn">
                    &ldquo;{currentQuote.text}&rdquo;
                    <span className="chat-empty-quote-author"> — {currentQuote.author}</span>
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '640px' }}>
                  {[
                    { text: 'Global Market Outlook', action: 'What is the current global market outlook across equities, bonds, and macro regimes?' },
                    { text: 'Intraday NVDA', action: '/intraday NVDA' },
                    { text: 'Scan IDX Momentum', action: 'Scan Indonesia stocks for high-probability momentum and breakout candidates' },
                    { text: 'Market News Intel', action: '/newsintel' },
                    { text: 'Longterm AAPL', action: '/longterm AAPL' },
                    { text: 'Crypto & Bitcoin Status', action: 'What is the current Bitcoin price action and crypto crowd sentiment?' },
                  ].map((s, i) => (
                    <button
                      key={i}
                      type="button"
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
                      <div className="flex-row gap-3" style={{ width: '100%' }}>
                        <div className="chat-assistant-avatar" style={{ flexShrink: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                          <img src="/logo-boz-solid.png" alt="BOZ" style={{ width: 22, height: 22, objectFit: 'contain' }} />
                        </div>
                        <div style={{ width: '100%', paddingTop: '2px' }}>
                          {msg.thoughts && msg.thoughts.length > 0 && (
                            <ThoughtAccordion
                              thoughts={msg.thoughts}
                              title="Thought process"
                              defaultOpen={false}
                            />
                          )}
                          {msg.content && (
                            <div dangerouslySetInnerHTML={{ __html: formatContent(msg.content) }} />
                          )}

                          {/* Ticker Typo Clarification Suggestions */}
                          {msg.suggestions && msg.suggestions.length > 0 && (
                            <div className="chat-suggestion-group">
                              <div className="chat-suggestion-label">Suggested Tickers:</div>
                              <div className="chat-suggestion-cards">
                                {msg.suggestions.map((s, si) => (
                                  <button
                                    key={si}
                                    type="button"
                                    className="chat-suggestion-card"
                                    onClick={() => sendMessage(s.command || `/intraday ${s.symbol}`)}
                                    title={`Run analysis for ${s.symbol}`}
                                  >
                                    <div className="chat-suggestion-card-main">
                                      <span className="chat-suggestion-symbol">{s.symbol}</span>
                                      <span className="chat-suggestion-name">{s.name}</span>
                                    </div>
                                    {s.exchange && <span className="chat-suggestion-exchange">{s.exchange}</span>}
                                    <i className="fa-solid fa-arrow-right chat-suggestion-arrow"></i>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Assistant Message Actions */}
                          {msg.content && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', paddingTop: '6px', borderTop: '1px solid rgba(255, 255, 255, 0.04)' }}>
                              <button
                                type="button"
                                onClick={() => copyMessage(msg.content, i)}
                                className="chat-copy-btn"
                                title="Copy response to clipboard"
                              >
                                <i className={copiedIndex === i ? 'fa-solid fa-check' : 'fa-regular fa-copy'} style={{ fontSize: '11px' }}></i>
                                <span>{copiedIndex === i ? 'Copied!' : 'Copy'}</span>
                              </button>
                            </div>
                          )}
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
                    <div className="flex-row gap-3" style={{ width: '100%' }}>
                      <div className="chat-assistant-avatar" style={{ flexShrink: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <img src="/logo-boz-solid.png" alt="BOZ" style={{ width: 22, height: 22, objectFit: 'contain' }} />
                      </div>
                      <div style={{ width: '100%', paddingTop: '2px' }}>
                        {streamingThoughts.length > 0 && (
                          <ThoughtAccordion
                            thoughts={streamingThoughts}
                            isStreaming={true}
                            defaultOpen={true}
                            title="Thought process"
                          />
                        )}
                        {streamingContent ? (
                          <div dangerouslySetInnerHTML={{ __html: formatContent(streamingContent) }} />
                        ) : streamingThoughts.length > 0 ? null : (
                          <div className="flex-row gap-2 items-center" style={{ height: '28px' }}>
                            <span className="spinner spinner-sm"></span>
                            <span className="page-subtitle animate-fadeIn" key={loadingStep} style={{ margin: 0, transition: 'all 0.3s ease' }}>
                              Analyzing market intelligence...
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

          {/* Input Area (Claude-style composer) */}
          <div className="chat-composer">
            {input.startsWith('/') && !input.includes(' ') && input !== '/newsintel' && (
              <div className="chat-slash-menu">
                <div className="chat-slash-menu-label">Slash Commands</div>
                
                {[
                  { cmd: '/intraday ', title: '/intraday [ticker]', desc: 'Live intraday analysis & key levels', icon: 'fa-chart-line' },
                  { cmd: '/longterm ', title: '/longterm [ticker]', desc: 'Fundamental analysis & long-term outlook', icon: 'fa-scale-balanced' },
                  { cmd: '/newsintel', title: '/newsintel', desc: 'Scan latest market headlines', icon: 'fa-newspaper' }
                ].filter(c => c.cmd.startsWith(input) || c.title.startsWith(input)).map(item => (
                  <button 
                    key={item.cmd}
                    type="button"
                    onClick={() => { setInput(item.cmd); textareaRef.current?.focus(); }}
                    className="chat-slash-item"
                  >
                    <div className="chat-slash-item-icon">
                      <i className={`fa-solid ${item.icon}`} style={{ fontSize: '11px' }}></i>
                    </div>
                    <div className="chat-slash-item-text">
                      <div className="chat-slash-item-title">{item.title}</div>
                      <div className="chat-slash-item-desc">{item.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <textarea
              ref={textareaRef}
              className="chat-composer-textarea"
              placeholder="Write a message or type '/' for commands..."
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />

            <div className="chat-composer-footer">
              <div className="chat-composer-footer-left">
                <button
                  type="button"
                  className="chat-composer-action-btn"
                  onClick={() => {
                    setInput((prev) => (prev ? prev : '/'));
                    textareaRef.current?.focus();
                  }}
                  title="Commands & tools"
                  aria-label="Commands"
                >
                  <i className="fa-solid fa-plus" style={{ fontSize: '12px' }}></i>
                </button>
              </div>

              <div className="chat-composer-footer-right">
                <ChatModelPicker />
                <button
                  type="button"
                  className={`chat-composer-send-btn${input.trim() ? ' active' : ''}`}
                  onClick={() => sendMessage()}
                  disabled={loading || !input.trim()}
                  title={loading ? 'Stop generation' : 'Send message (Enter)'}
                  aria-label="Send message"
                >
                  {loading ? (
                    <i className="fa-solid fa-stop" style={{ fontSize: '12px' }}></i>
                  ) : (
                    <i className="fa-solid fa-arrow-up" style={{ fontSize: '13px' }}></i>
                  )}
                </button>
              </div>
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
