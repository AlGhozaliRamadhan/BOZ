'use client';

import { useState, useEffect, useRef } from 'react';

export default function TopBar() {
  const [config, setConfig] = useState<any>(null);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch settings:', err));
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectProvider = async (providerId: string) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      console.error('Failed to update provider:', err);
    }
  };

  return (
    <>
      <style>{`
        @keyframes dropdownReveal {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <header className="topbar">


      <div className="topbar-actions">
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <div 
            className="topbar-badge" 
            style={{ 
              padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', 
              transition: 'all 0.2s ease', background: dropdownOpen ? 'var(--surface-glass-active)' : 'var(--surface-glass)' 
            }}
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span className="topbar-badge-dot" style={{ 
              background: config?.provider === 'nvidia' ? '#76b900' : 
                         config?.provider === 'offline' ? '#ff9900' : 'var(--accent-cyan)',
              flexShrink: 0
            }} title={`Provider: ${config?.provider}`} />
            <span style={{ fontSize: '13px', fontWeight: 500, userSelect: 'none', minWidth: '90px' }}>
              {config?.provider === 'github' ? 'GitHub Models' : 
               config?.provider === 'nvidia' ? 'NVIDIA NIM' : 
               config?.provider === 'offline' ? 'Ollama' : 'Loading...'}
            </span>
            <svg 
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ opacity: 0.6, transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {dropdownOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: '8px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
              minWidth: '160px', overflow: 'hidden', zIndex: 100,
              display: 'flex', flexDirection: 'column', padding: '4px'
            }}>
              {[
                { id: 'github', label: 'GitHub Models', color: 'var(--accent-cyan)' },
                { id: 'nvidia', label: 'NVIDIA NIM', color: '#76b900' },
                { id: 'offline', label: 'Ollama', color: '#ff9900' }
              ].map((opt, i) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    selectProvider(opt.id);
                    setDropdownOpen(false);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                    padding: '8px 12px', background: config?.provider === opt.id ? 'rgba(0,0,0,0.04)' : 'transparent',
                    border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    textAlign: 'left', color: 'var(--text-primary)', fontSize: '13px',
                    transition: 'background 0.1s ease',
                    opacity: 0,
                    animation: 'dropdownReveal 0.2s ease forwards',
                    animationDelay: `${i * 0.05}s`
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.04)'}
                  onMouseOut={(e) => e.currentTarget.style.background = config?.provider === opt.id ? 'rgba(0,0,0,0.04)' : 'transparent'}
                >
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: opt.color, flexShrink: 0 }} />
                  {opt.label}
                  {config?.provider === opt.id && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', opacity: 0.7 }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="topbar-badge">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
            <polyline points="7,4 7,7 9.5,8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Market Open</span>
        </div>
      </div>
    </header>
    </>
  );
}

