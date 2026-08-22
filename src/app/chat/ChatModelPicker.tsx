'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface ModelOption {
  id: string;
  label: string;
  provider?: string;
}

interface SettingsSnapshot {
  provider: string;
  model: string;
  availableModels: ModelOption[];
  allModels: ModelOption[];
}

const PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub',
  nvidia: 'NVIDIA',
  offline: 'Offline',
  custom: '9router',
};

const PROVIDER_ORDER = ['custom', 'nvidia', 'github', 'offline'] as const;

export default function ChatModelPicker() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [customDraft, setCustomDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [liveCustomModels, setLiveCustomModels] = useState<ModelOption[]>([]);
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json();
      setSettings({
        provider: data.provider,
        model: data.model,
        availableModels: data.availableModels || [],
        allModels: data.allModels || [],
      });
      if (data.provider === 'custom') {
        try {
          const modelsRes = await fetch('/api/custom-models');
          if (modelsRes.ok) {
            const modelsData = await modelsRes.json();
            setLiveCustomModels(Array.isArray(modelsData.models) ? modelsData.models : []);
          }
        } catch {
          // keep cached models
        }
      }
    } catch {
      // picker stays on last known state
    }
  }, []);

  useEffect(() => {
    loadSettings();
    const sync = () => { loadSettings(); };
    window.addEventListener('boz_settings_updated', sync);
    return () => window.removeEventListener('boz_settings_updated', sync);
  }, [loadSettings]);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSwitchingProvider(false);
      return;
    }
    const timer = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);

    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSwitchingProvider(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const applyModel = async (provider: string, model: string) => {
    if (!model.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model: model.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save model');
      const data = await res.json();
      setSettings({
        provider: data.provider,
        model: data.model,
        availableModels: data.availableModels || [],
        allModels: data.allModels || [],
      });
      window.dispatchEvent(new Event('boz_settings_updated'));
      setOpen(false);
      setSwitchingProvider(false);
      setCustomDraft('');
      setSearchQuery('');
    } catch {
      // keep picker open so the user can retry
    } finally {
      setSaving(false);
    }
  };

  const switchProvider = async (providerId: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      if (!res.ok) throw new Error('Failed to switch provider');
      const data = await res.json();
      setSettings({
        provider: data.provider,
        model: data.model,
        availableModels: data.availableModels || [],
        allModels: data.allModels || [],
      });
      if (data.provider === 'custom') {
        try {
          const modelsRes = await fetch('/api/custom-models');
          if (modelsRes.ok) {
            const modelsData = await modelsRes.json();
            setLiveCustomModels(Array.isArray(modelsData.models) ? modelsData.models : []);
          }
        } catch { /* use cached */ }
      }
      window.dispatchEvent(new Event('boz_settings_updated'));
      setSwitchingProvider(false);
      setSearchQuery('');
    } catch {
      // keep picker open
    } finally {
      setSaving(false);
    }
  };

  const provider = settings?.provider || 'custom';
  const model = settings?.model || '';
  const shortModel = model.split('/').pop() || model || 'Select model';

  const listed =
    provider === 'custom'
      ? (liveCustomModels.length > 0 ? liveCustomModels : settings?.availableModels || [])
      : settings?.availableModels || [];

  const filteredModels = listed.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const label = (m.label || '').toLowerCase();
    const id = (m.id || '').toLowerCase();
    return label.includes(q) || id.includes(q);
  });

  return (
    <div className="chat-model-picker" ref={rootRef}>
      <button
        type="button"
        className="chat-model-trigger"
        onClick={() => setOpen((v) => !v)}
        title={`${PROVIDER_LABEL[provider] || provider} / ${model || 'no model'}`}
        disabled={saving}
      >
        <span className="chat-model-provider">{PROVIDER_LABEL[provider] || provider}</span>
        <span className="chat-model-id">{shortModel}</span>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: '10px', opacity: 0.7 }}></i>
      </button>

      {open && (
        <div className="chat-model-menu animate-fadeIn">
          {/* Provider switcher */}
          {switchingProvider ? (
            <>
              <div className="chat-model-menu-label">Switch provider</div>
              {PROVIDER_ORDER.map((pid) => (
                <button
                  key={pid}
                  type="button"
                  className={`chat-model-option${pid === provider ? ' active' : ''}`}
                  onClick={() => switchProvider(pid)}
                  disabled={saving}
                >
                  <span>{PROVIDER_LABEL[pid] || pid}</span>
                  {pid === provider && <i className="fa-solid fa-check" style={{ fontSize: '11px' }}></i>}
                </button>
              ))}
              <button
                type="button"
                className="chat-model-settings"
                onClick={() => setSwitchingProvider(false)}
              >
                ← Back to models
              </button>
            </>
          ) : (
            <>
              <div className="chat-model-menu-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{PROVIDER_LABEL[provider] || provider} models</span>
                <button
                  type="button"
                  onClick={() => setSwitchingProvider(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-cyan)',
                    cursor: 'pointer',
                    fontSize: '10px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    padding: '0 2px',
                  }}
                >
                  Switch
                </button>
              </div>

              {/* Search Box */}
              <div className="chat-model-search-box">
                <i className="fa-solid fa-magnifying-glass chat-model-search-icon"></i>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="chat-model-search-input"
                  placeholder="Search models..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (filteredModels.length > 0) {
                        applyModel(provider, filteredModels[0].id);
                      } else if (searchQuery.trim()) {
                        applyModel(provider, searchQuery.trim());
                      }
                    }
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="chat-model-search-clear"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    title="Clear search"
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                )}
              </div>

              {/* Model list */}
              <div className="chat-model-list">
                {filteredModels.length === 0 && listed.length > 0 && searchQuery && (
                  <div className="chat-model-empty">
                    No models matching &ldquo;{searchQuery}&rdquo;
                  </div>
                )}

                {filteredModels.length === 0 && listed.length === 0 && provider !== 'custom' && (
                  <div className="chat-model-empty">No models listed for this provider.</div>
                )}

                {filteredModels.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`chat-model-option${m.id === model ? ' active' : ''}`}
                    onClick={() => applyModel(provider, m.id)}
                    disabled={saving}
                  >
                    <div className="chat-model-option-info">
                      <span className="chat-model-option-name">{m.label || m.id}</span>
                      {m.label && m.label !== m.id && (
                        <span className="chat-model-option-id">{m.id}</span>
                      )}
                    </div>
                    {m.id === model && <i className="fa-solid fa-check" style={{ fontSize: '11px' }}></i>}
                  </button>
                ))}
              </div>

              {provider === 'custom' && (
                <form
                  className="chat-model-custom-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    applyModel('custom', customDraft || searchQuery);
                  }}
                >
                  <input
                    type="text"
                    value={customDraft}
                    onChange={(e) => setCustomDraft(e.target.value)}
                    placeholder="Type custom model ID"
                    className="chat-model-custom-input"
                  />
                  <button type="submit" disabled={saving || (!customDraft.trim() && !searchQuery.trim())} className="chat-model-custom-btn">
                    Use
                  </button>
                </form>
              )}

              <button
                type="button"
                className="chat-model-settings"
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new Event('boz_open_settings'));
                }}
              >
                <i className="fa-solid fa-gear" style={{ fontSize: '11px', marginRight: '6px', opacity: 0.6 }}></i>
                Open provider settings
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
