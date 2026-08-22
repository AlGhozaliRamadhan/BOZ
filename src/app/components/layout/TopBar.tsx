'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SettingsModal from '../ui/SettingsModal';
import {
  EFFORT_OPTIONS,
  type Effort,
  DEFAULT_EFFORT,
  getEffort,
  setEffort,
  getThinkingEnabled,
  setThinkingEnabled,
  CHAT_OPTIONS_EVENT,
} from '../../../shared/chat-options';

export default function TopBar() {
  const pathname = usePathname();
  const [config, setConfig] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dynamicModels, setDynamicModels] = useState<any[]>([]);
  const [searchResultModels, setSearchResultModels] = useState<any[] | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [lastUsedAi, setLastUsedAi] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('github');
  // Neutral SSR-safe defaults. The real persisted values are read in the mount
  // effect below — initializing with getEffort()/getThinkingEnabled() here would
  // bake the server-side default (thinking=on) into the hydrated state, so the
  // pill would show the brain icon after a reload even when thinking is off.
  const [effort, setEffortState] = useState<Effort>(DEFAULT_EFFORT);
  const [thinkingEnabled, setThinkingEnabledState] = useState<boolean>(false);
  const [effortOpen, setEffortOpen] = useState(false);
  
  const providers = [
    { id: 'custom', label: '9router', color: 'var(--accent-cyan)' },
    { id: 'nvidia', label: 'NVIDIA', color: '#76b900' },
    { id: 'github', label: 'GitHub', color: '#00d2ff' },
    { id: 'offline', label: 'Offline', color: '#ff9900' }
  ];

  useEffect(() => {
    const saved = localStorage.getItem('boz_last_ai');
    if (saved) setLastUsedAi(saved);
  }, []);

  // Keep effort / Deep Think pills in sync when changed elsewhere (Settings).
  // sync() also runs once on mount to hydrate the real persisted values (the
  // useState initializers above are SSR-safe placeholders).
  useEffect(() => {
    const sync = () => {
      setEffortState(getEffort());
      setThinkingEnabledState(getThinkingEnabled());
    };
    sync();
    window.addEventListener(CHAT_OPTIONS_EVENT, sync);
    return () => window.removeEventListener(CHAT_OPTIONS_EVENT, sync);
  }, []);

  useEffect(() => {
    const handleOpenSettings = () => setSettingsOpen(true);
    window.addEventListener('boz_open_settings', handleOpenSettings);
    return () => window.removeEventListener('boz_open_settings', handleOpenSettings);
  }, []);

  const loadSettings = () => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        setConfig(data);
        if (data.provider) setSelectedProvider(data.provider);
        if (data.model) {
          const provLabel = data.provider === 'custom' ? '9router' : data.provider === 'github' ? 'GitHub' : data.provider === 'nvidia' ? 'NVIDIA' : 'Offline';
          const displayStr = `${provLabel} • ${data.model}`;
          setLastUsedAi(displayStr);
        }
      })
      .catch(err => console.error('Failed to fetch settings:', err));
  };

  useEffect(() => {
    loadSettings();
    window.addEventListener('boz_settings_updated', loadSettings);
    return () => window.removeEventListener('boz_settings_updated', loadSettings);
  }, []);

  useEffect(() => {
    if (modalOpen) {
      if (dynamicModels.length === 0 && !isFetchingModels) {
        setIsFetchingModels(true);
        Promise.all([
          fetch('/api/custom-models').then(res => res.json()).catch(() => ({ models: [] })),
          fetch('/api/github-models').then(res => res.json()).catch(() => ({ models: [] })),
          fetch('/api/nvidia-models').then(res => res.json()).catch(() => ({ models: [] }))
        ]).then(([customData, ghData, nvData]) => {
           const models: any[] = [];
           if (customData.models) {
             models.push(...customData.models.map((m: any) => ({ ...m, provider: 'custom' })));
           }
           if (ghData.models) {
             models.push(...ghData.models.map((m: any) => ({ ...m, provider: 'github' })));
           }
           if (nvData.models) {
             models.push(...nvData.models.map((m: any) => ({ ...m, provider: 'nvidia' })));
           }
           setDynamicModels(models);
        }).finally(() => setIsFetchingModels(false));
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
        const provLabel = providerId === 'custom' ? '9router' : providerId === 'github' ? 'GitHub' : providerId === 'nvidia' ? 'NVIDIA' : 'Offline';
        const displayStr = `${provLabel} • ${modelId}`;
        setLastUsedAi(displayStr);
        localStorage.setItem('boz_last_ai', displayStr);
        window.dispatchEvent(new Event('boz_settings_updated'));
      }
    } catch (err) {
      console.error('Failed to update config:', err);
    }
  };

  const baseModels = [...(config?.allModels || [])];
  
  let filteredModels: any[] = [];
  
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
          width: 90%; max-width: 800px;
          height: 65vh; min-height: 400px;
          display: flex; flex-direction: row;
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
          flex: 1; overflow-y: auto; padding: 12px;
        }
        .ai-model-item {
          display: flex; flex-direction: column; padding: 14px 16px;
          border-radius: var(--radius-md); cursor: pointer;
          transition: background 0.1s ease;
          margin-bottom: 8px;
          border: 1px solid transparent;
        }
        .ai-model-item:last-child {
          margin-bottom: 0;
        }
        .ai-model-item:hover {
          background: var(--surface-glass-active);
          border-color: var(--border-glass);
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
        .effort-option:hover {
          background: rgba(255, 255, 255, 0.08) !important;
        }
        .effort-info {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .effort-info-icon {
          cursor: help;
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1;
        }
        .effort-info:hover .effort-info-icon {
          color: var(--text-primary);
        }
        .effort-tooltip {
          position: absolute;
          left: 50%;
          bottom: calc(100% + 8px);
          transform: translateX(-50%);
          background: var(--bg-elevated);
          border: 1px solid var(--border-glass);
          border-radius: var(--radius-sm);
          padding: 5px 10px;
          font-size: 11px;
          font-weight: 400;
          color: var(--text-primary);
          white-space: nowrap;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition: opacity 0.15s ease;
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
          z-index: 60;
        }
        .effort-info:hover .effort-tooltip {
          opacity: 1;
          visibility: visible;
        }
        .ai-modal-sidebar {
          width: 200px;
          background: rgba(0,0,0,0.1);
          border-right: 1px solid var(--border-glass);
          display: flex;
          flex-direction: column;
        }
        .ai-provider-item {
          padding: 14px 16px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          color: var(--text-muted);
          transition: all 0.15s ease;
          border-left: 2px solid transparent;
        }
        .ai-provider-item:hover {
          background: var(--surface-glass);
          color: var(--text-primary);
        }
        .ai-provider-item.active {
          background: var(--surface-glass-active);
          color: var(--text-primary);
          border-left: 2px solid var(--accent-cyan);
        }
      `}</style>
      
      <header className="topbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        
        {/* Left Side placeholder to balance the flex if needed */}
        <div style={{ flex: 1 }}></div>

        {/* Center: AI controls — only shown on the Chat page */}
        {pathname === '/chat' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="topbar-center-btn" onClick={() => setModalOpen(true)}>
              {lastUsedAi ? lastUsedAi : 'Select AI Model'}
            </button>

            <div style={{ position: 'relative' }}>
              <button className="topbar-center-btn" onClick={() => setEffortOpen(o => !o)} title="Thinking effort">
                <span>Effort: {effort}</span>
              </button>
              {effortOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setEffortOpen(false)} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', zIndex: 50,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-md)', boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
                    minWidth: '190px', padding: '6px',
                  }}>
                    <div style={{ padding: '6px 10px 4px', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                      Thinking Effort
                    </div>
                    {EFFORT_OPTIONS.map(opt => (
                      <button
                        key={opt}
                        onClick={() => { setEffort(opt); setEffortOpen(false); }}
                        className="effort-option"
                        style={{
                          display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                          padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                          background: opt === effort ? 'var(--surface-glass-active)' : 'transparent',
                          border: 'none', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {opt}
                          {opt === 'Medium' && (
                            <span className="effort-info">
                              <span className="effort-info-icon">ⓘ</span>
                              <span className="effort-tooltip">Default thinking effort</span>
                            </span>
                          )}
                        </span>
                        {opt === effort && <i className="fa-solid fa-check" style={{ fontSize: '11px' }} />}
                      </button>
                    ))}

                    <div style={{ height: '1px', background: 'var(--border-glass)', margin: '6px 8px' }} />

                    {/* Think Longer left-right switch */}
                    <button
                      onClick={() => setThinkingEnabled(!thinkingEnabled)}
                      style={{
                        display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                        background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer',
                      }}
                    >
                      <span>Think Longer</span>
                      {/* switch track */}
                      <span style={{
                        position: 'relative', width: '36px', height: '20px', borderRadius: '999px',
                        background: thinkingEnabled ? 'var(--text-primary)' : 'rgba(255,255,255,0.15)',
                        transition: 'background 0.2s', flexShrink: 0,
                      }}>
                        <span style={{
                          position: 'absolute', top: '2px', left: thinkingEnabled ? '18px' : '2px',
                          width: '16px', height: '16px', borderRadius: '50%',
                          background: 'var(--bg-elevated)', transition: 'left 0.2s',
                        }} />
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Right Side: Actions */}
        <div className="topbar-actions" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px' }}>
        </div>
      </header>

      {/* AI Search WINDOW (Modal) */}
      {modalOpen && (
        <div className="ai-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="ai-modal-content" onClick={e => e.stopPropagation()}>
            
            {/* LEFT SIDEBAR */}
            <div className="ai-modal-sidebar">
              <div style={{ padding: '24px 16px 12px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)' }}>
                Providers
              </div>
              {providers.map(p => (
                <div 
                  key={p.id}
                  className={`ai-provider-item ${selectedProvider === p.id ? 'active' : ''}`}
                  onClick={() => { setSelectedProvider(p.id); setSearchQuery(''); }}
                  style={{ 
                    borderLeftColor: selectedProvider === p.id ? p.color : 'transparent',
                    color: selectedProvider === p.id ? p.color : 'var(--text-muted)'
                  }}
                >
                  {p.label}
                </div>
              ))}
            </div>

            {/* RIGHT PANE */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              
              {/* Header with Search and Add Custom */}
              <div className="ai-modal-search" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  ref={searchInputRef}
                  className="ai-modal-input"
                  style={{ flex: 1 }}
                  placeholder={`Search ${providers.find(p => p.id === selectedProvider)?.label} models...`}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button 
                  className="topbar-center-btn" 
                  style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap' }}
                  onClick={() => {
                    const custom = prompt(`Enter custom ${providers.find(p => p.id === selectedProvider)?.label} model ID:`);
                    if (custom && custom.trim()) {
                      handleSelectModel(selectedProvider, custom.trim());
                    }
                  }}
                >
                  <i className="fa-solid fa-plus"></i> Add Custom
                </button>
              </div>
              
              {/* Models List */}
              <div className="ai-modal-list">
                {filteredModels.filter((m: any) => m.provider === selectedProvider).length > 0 ? (
                  filteredModels.filter((m: any) => m.provider === selectedProvider).map((m: any) => {
                    const isActive = config?.provider === m.provider && config?.model === m.id;
                    return (
                      <div 
                        key={`${m.provider}-${m.id}`} 
                        className="ai-model-item"
                        onClick={() => handleSelectModel(m.provider, m.id)}
                        style={{ background: isActive ? 'rgba(0,0,0,0.05)' : '' }}
                      >
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
                      onClick={() => handleSelectModel(selectedProvider, searchQuery.trim())}
                    >
                      <div className="ai-model-name">Use "{searchQuery.trim()}"</div>
                      <div className="ai-model-desc">Press Enter to select as custom {providers.find(p => p.id === selectedProvider)?.label} model</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', padding: '40px 20px', alignItems: 'center', gap: '16px', opacity: 0.8 }}>
                      <div style={{ fontSize: '13px', textAlign: 'center' }}>
                        No default {providers.find(p => p.id === selectedProvider)?.label} models available
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
            
          </div>
        </div>
      )}
      {/* Settings Modal */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
