'use client';

import { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function formatContent(content: string): string {
  // Basic markdown-like formatting: bold, code, newlines
  return content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code style="background:rgba(0,212,255,0.1);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);font-size:var(--text-xs)">$1</code>')
    .replace(/\n/g, '<br/>');
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

    const userMessage: ChatMessage = { role: 'user', content: input.trim() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage.content,
          history: updatedMessages,
        }),
      });

      if (!res.ok) throw new Error('Failed to get response');

      const data = await res.json();
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.response || data.message || 'No response received.',
      };
      setMessages([...updatedMessages, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      // Add error message as assistant response
      setMessages([
        ...updatedMessages,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error processing your request. Please try again.',
        },
      ]);
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

  const clearChat = () => {
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <div className="animate-fadeIn">
      {/* Header */}
      <div className="page-header">
        <div className="flex-row justify-between items-center">
          <div>
            <h1 className="page-title">Chat Agent</h1>
            <p className="page-subtitle">AI-powered market analysis assistant</p>
          </div>
          {messages.length > 0 && (
            <button className="btn btn-ghost" onClick={clearChat}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Clear Chat
            </button>
          )}
        </div>
      </div>

      {/* Chat Container */}
      <div className="glass-card flush">
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
                    📊 Market outlook
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setInput('Analyze NVDA for intraday trading'); }}
                  >
                    📈 Analyze NVDA
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setInput('What are the best momentum stocks today?'); }}
                  >
                    🔥 Momentum stocks
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => { setInput('Explain the current VIX level'); }}
                  >
                    ⚡ Explain VIX
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
                        <div dangerouslySetInnerHTML={{ __html: formatContent(msg.content) }} />
                      </div>
                    ) : (
                      <span>{msg.content}</span>
                    )}
                  </div>
                ))}

                {/* Loading indicator */}
                {loading && (
                  <div className="chat-bubble assistant">
                    <div className="flex-row gap-3 items-center">
                      <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 'var(--radius-sm)', background: 'var(--accent-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--bg-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                      </div>
                      <div className="flex-row gap-2 items-center">
                        <span className="spinner spinner-sm"></span>
                        <span className="page-subtitle">Thinking...</span>
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
