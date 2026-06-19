'use client';

import { useState, useEffect, useRef } from 'react';

export default function TopBar() {
  const [config, setConfig] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dynamicModels, setDynamicModels] = useState<any[]>([]);
  const [searchResultModels, setSearchResultModels] = useState<any[] | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(err => console.error('Failed to fetch settings:', err));
  }, []);

  useEffect(() => {
    if (modalOpen) {
      if (dynamicModels.length === 0 && !isFetchingModels) {
        setIsFetchingModels(true);
        fetch('/api/github-models')
          .then(res => res.json())
          .then(data => {
            if (data.models) {
              setDynamicModels(data.models.map((m: any) => ({ ...m, provider: 'github' })));
            }
          })
          .catch(err => console.error('Failed to fetch dynamic models:', err))
          .finally(() => setIsFetchingModels(false));
      }
    }
  }, [modalOpen]);

  useEffect(() => {
    if (modalOpen) {
      setSearchQuery('');
      setSearchResultModels(null);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [modalOpen]);

  useEffect(() => {
    if (modalOpen && searchQuery.trim().length > 1) {
      const delay = setTimeout(() => {
        setIsFetchingModels(true);
        fetch(`/api/github-models?query=${encodeURIComponent(searchQuery.trim())}`)
          .then(res => res.json())
          .then(data => {
            if (data.models) {
              setSearchResultModels(data.models.map((m: any) => ({ ...m, provider: 'github' })));
            }
          })
          .catch(err => console.error('Failed to search github models:', err))
          .finally(() => setIsFetchingModels(false));
      }, 500);
      return () => clearTimeout(delay);
    } else {
      setSearchResultModels(null);
    }
  }, [searchQuery, modalOpen]);

  const handleSelectModel = async (providerId: string, modelId: string) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, model: modelId }),
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        setModalOpen(false);
      }
    } catch (err) {
      console.error('Failed to update config:', err);
    }
  };

  const baseModels = [...(config?.allModels || [])];
  
  let filteredModels = [];
  
  if (searchQuery.trim().length > 1) {
    // 1. Find local matches
    const localMatches = baseModels.filter((m: any) => 
      m.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
      m.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.provider.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    filteredModels = [...localMatches];
    
    // 2. Append backend search results, but apply local substring filter
    // so we don't show irrelevant models that GitHub's fuzzy search returns
    if (searchResultModels) {
      searchResultModels.forEach(sm => {
        const smMatches = sm.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          sm.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          sm.provider.toLowerCase().includes(searchQuery.toLowerCase());
        if (smMatches && !filteredModels.some(fm => fm.id === sm.id)) {
          filteredModels.push(sm);
        }
      });
    }
  } else {
    // When no search query, show base models + default dynamic models
    filteredModels = [...baseModels];
    dynamicModels.forEach(dm => {
      if (!filteredModels.some(fm => fm.id === dm.id)) {
        filteredModels.push(dm);
      }
    });
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setModalOpen(false);
    if (e.key === 'Enter') {
      if (filteredModels.length > 0) {
        handleSelectModel(filteredModels[0].provider, filteredModels[0].id);
      } else if (searchQuery.trim()) {
        handleSelectModel('offline', searchQuery.trim());
      }
    }
  };

  return (
    <>
      <style>{`
        .ai-modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.5); z-index: 9999;
          display: flex; align-items: flex-start; justify-content: center;
          padding-top: 60px;
        }
        .ai-modal-content {
          background: var(--bg-elevated);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-lg);
          box-shadow: 0 20px 40px rgba(0,0,0,0.3);
          width: 90%; max-width: 600px;
          display: flex; flex-direction: column;
          overflow: hidden;
        }
        .ai-modal-search {
          padding: 16px 20px;
          border-bottom: 1px solid var(--border-glass);
          background: var(--surface-glass);
        }
        .ai-modal-input {
          width: 100%; background: transparent; border: none; outline: none;
          color: var(--text-primary); font-size: 16px; text-align: left;
        }
        .ai-modal-list {
          max-height: 50vh; overflow-y: auto; padding: 8px;
        }
        .ai-model-item {
          display: flex; flex-direction: column; padding: 12px 16px;
          border-radius: var(--radius-md); cursor: pointer;
          transition: background 0.1s ease;
        }
        .ai-model-item:hover {
          background: var(--surface-glass-active);
        }
        .ai-model-provider {
          font-size: 11px; text-transform: uppercase; font-weight: 600;
          letter-spacing: 0.5px; opacity: 0.7; margin-bottom: 4px;
        }
        .ai-model-name {
          font-size: 14px; font-weight: 500; color: var(--text-primary);
        }
        .ai-model-desc {
          font-size: 12px; color: var(--text-muted); margin-top: 2px;
        }
        .topbar-center-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 16px; border-radius: var(--radius-full);
          background: var(--surface-glass); border: 1px solid var(--border-glass);
          cursor: pointer; transition: all 0.2s ease;
          color: var(--text-primary); font-size: 13px; font-weight: 500;
        }
        .topbar-center-btn:hover {
          background: var(--surface-glass-active);
          border-color: rgba(255, 255, 255, 0.2);
        }
      `}</style>
      
      <header className="topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        
        {/* Left Side placeholder to balance the flex if needed */}
        <div style={{ flex: 1 }}></div>

        {/* Center: AI Search Button */}
        <button className="topbar-center-btn" onClick={() => setModalOpen(true)}>
          {config ? `${config.provider === 'github' ? 'GitHub' : config.provider === 'nvidia' ? 'NVIDIA' : 'Ollama'} • ${config.model}` : 'Loading AI...'}
        </button>

        {/* Right Side: Actions */}
        <div className="topbar-actions" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <div className="topbar-badge">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
              <polyline points="7,4 7,7 9.5,8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Market Open</span>
          </div>
        </div>
      </header>

      {/* AI Search WINDOW (Modal) */}
      {modalOpen && (
        <div className="ai-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="ai-modal-content" onClick={e => e.stopPropagation()}>
            <div className="ai-modal-search">
              <input
                ref={searchInputRef}
                className="ai-modal-input"
                placeholder="Search AI models (e.g. gpt-4, llama, claude)..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
            
            <div className="ai-modal-list">
              {filteredModels.length > 0 ? (
                filteredModels.map((m: any) => {
                  const isActive = config?.provider === m.provider && config?.model === m.id;
                  return (
                    <div 
                      key={`${m.provider}-${m.id}`} 
                      className="ai-model-item"
                      onClick={() => handleSelectModel(m.provider, m.id)}
                      style={{ background: isActive ? 'rgba(0,0,0,0.05)' : '' }}
                    >
                      <div className="ai-model-provider" style={{ 
                        color: m.provider === 'nvidia' ? '#76b900' : m.provider === 'offline' ? '#ff9900' : 'var(--accent-cyan)'
                      }}>
                        {m.provider}
                      </div>
                      <div className="ai-model-name flex-row items-center justify-between">
                        {m.id}
                        {isActive && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                      </div>
                      <div className="ai-model-desc">{m.label}</div>
                    </div>
                  );
                })
              ) : (
                searchQuery.trim() ? (
                  <div 
                    className="ai-model-item"
                    onClick={() => handleSelectModel('offline', searchQuery.trim())}
                  >
                    <div className="ai-model-provider" style={{ color: '#ff9900' }}>OLLAMA (LOCAL)</div>
                    <div className="ai-model-name">Use "{searchQuery.trim()}"</div>
                    <div className="ai-model-desc">Press Enter to select as local model</div>
                  </div>
                ) : (
                  <div style={{ padding: '20px', textAlign: 'center', opacity: 0.5, fontSize: '13px' }}>
                    Type to search for an AI model
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
