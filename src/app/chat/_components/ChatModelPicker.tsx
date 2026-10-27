'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './ChatModelPicker.module.css';
import { groupModelsByPrefix } from '../_lib/model-groups';

interface ModelOption {
  id: string;
  label: string;
  provider?: string;
}

interface ProviderSetupState {
  configured: boolean;
  issue: 'no-credential' | 'no-model' | null;
}

interface SettingsSnapshot {
  provider: string;
  model: string;
  availableModels: ModelOption[];
  allModels: ModelOption[];
  setup?: ProviderSetupState;
}

const PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  offline: 'Offline',
  custom: '9router',
};

const PROVIDER_ORDER = [
  'openai', 'anthropic', 'groq', 'openrouter', 'custom', 'nvidia', 'github', 'offline',
] as const;

// Module-level empty list: `settings?.availableModels || []` allocated a new
// array on every render and restarted the picker's memo/effect cycle each time.
const EMPTY_MODELS: ModelOption[] = [];

export default function ChatModelPicker() {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [customDraft, setCustomDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [switchingProvider, setSwitchingProvider] = useState(false);
  // Full catalog for the connected provider (`/api/models`), or null until a
  // listing for the current provider has arrived.
  const [liveListing, setLiveListing] = useState<{ models: ModelOption[]; live: boolean } | null>(null);
  const [liveFor, setLiveFor] = useState('');
  // Collapsed/expanded folder prefixes; expanded folders are visible, and the
  // folder holding the active model auto-expands on open.
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
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
        setup: data.setup,
      });
      // A listing cached for another provider (or before settings changed)
      // must not leak into the freshly selected one's menu.
      setLiveListing(null);
      setLiveFor('');
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

  // Pull the provider's full catalog when the menu opens. The curated list is
  // shown immediately; the live list replaces it once fetched.
  useEffect(() => {
    if (!open) return;
    const providerId = settings?.provider;
    if (!providerId || liveFor === providerId) return;
    let cancelled = false;
    fetch(`/api/models?provider=${encodeURIComponent(providerId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || Array.isArray(data.models) === false) return;
        setLiveListing({ models: data.models || [], live: data.source === 'live' });
        setLiveFor(providerId);
      })
      .catch(() => {
        // curated list keeps serving
      });
    return () => { cancelled = true; };
  }, [open, settings?.provider, liveFor]);

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

  // The fetched listing (live or persisted fallback) is the per-provider view
  // the models route assembled; before it arrives, serve the settings
  // snapshot's curated list for the active provider.
  //
  // Identity matters, not just value: `grouped` below is memoized on this
  // object, and the folder effect re-runs on every `grouped` change. Without a
  // stable fallback, `settings?.availableModels || []` minted a new array on
  // every render (always, while settings were still loading) — new `grouped`,
  // new `setExpandedFolders` state, new render: an unbreakable loop.
  const listed = useMemo(
    () => (liveListing ? liveListing.models : settings?.availableModels || EMPTY_MODELS),
    [liveListing, settings?.availableModels],
  );

  const grouped = useMemo(() => groupModelsByPrefix(listed as { id: string }[]), [listed]);

  // The folder holding the active model auto-expands whenever the menu opens
  // or the catalog changes, so the current pick is always the first thing
  // visible. Manual folds reset by design on each open.
  useEffect(() => {
    if (!open) return;
    const active = settings?.model || '';
    const folder = grouped.groups.find((g) => g.models.some((m) => m.id === active));
    const next = folder ? [folder.prefix] : [];
    // Same folder already expanded → keep the previous identity so React can
    // bail out instead of re-rendering for an equal value.
    setExpandedFolders((prev) =>
      prev.length === next.length && prev.every((value, index) => value === next[index]) ? prev : next,
    );
  }, [open, settings?.model, grouped]);

  const { groups, ungrouped } = grouped;

  const provider = settings?.provider || 'custom';
  const model = settings?.model || '';
  const setup = settings?.setup || null;
  const notSetUp = setup ? !setup.configured : false;
  const shortModel = model.split('/').pop() || model || 'Select model';
  const searching = searchQuery.trim().length > 0;

  const filteredModels = listed.filter((m) => {
    if (!searching) return true;
    const q = searchQuery.toLowerCase().trim();
    const label = (m.label || '').toLowerCase();
    const id = (m.id || '').toLowerCase();
    return label.includes(q) || id.includes(q);
  });

  const applyModel = async (pickedProvider: string, pickedModel: string) => {
    if (!pickedModel.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: pickedProvider, model: pickedModel.trim() }),
      });
      if (!res.ok) throw new Error('Failed to save model');
      const data = await res.json();
      setSettings({
        provider: data.provider,
        model: data.model,
        availableModels: data.availableModels || [],
        allModels: data.allModels || [],
        setup: data.setup,
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
        setup: data.setup,
      });
      setLiveListing(null);
      setLiveFor('');
      window.dispatchEvent(new Event('boz_settings_updated'));
      setSwitchingProvider(false);
      setSearchQuery('');
      setCustomDraft('');
    } catch {
      // keep picker open
    } finally {
      setSaving(false);
    }
  };

  const toggleFolder = (prefix: string) => {
    setExpandedFolders((prev) =>
      prev.includes(prefix) ? prev.filter((p) => p !== prefix) : [...prev, prefix],
    );
  };

  const rowProps = (m: { id: string }) => ({
    type: 'button' as const,
    className: `${styles['chat-model-option']}${m.id === model ? ' active' : ''}`,
    onClick: () => { void applyModel(provider, m.id); },
    disabled: saving,
  });

  const modelRows = (models: ReadonlyArray<{ id: string; label?: string }>) => models.map((m) => (
    <button key={m.id} {...rowProps(m)}>
      <div className={styles['chat-model-option-info']}>
        <span className={styles['chat-model-option-name']}>{m.label || m.id}</span>
        {m.label && m.label !== m.id && (
          <span className={styles['chat-model-option-id']}>{m.id}</span>
        )}
      </div>
      {m.id === model && <i className="fa-solid fa-check" style={{ fontSize: '11px' }}></i>}
    </button>
  ));

  return (
    <div className={styles['chat-model-picker']} ref={rootRef}>
      <button
        type="button"
        className={styles['chat-model-trigger']}
        onClick={() => setOpen((v) => !v)}
        title={
          notSetUp
            ? 'No usable model is set up yet — open the picker to fix this'
            : `${PROVIDER_LABEL[provider] || provider} / ${model || 'no model'}`
        }
        disabled={saving}
      >
        <span className={styles['chat-model-provider']}>{PROVIDER_LABEL[provider] || provider}</span>
        {notSetUp ? (
          <span className={`${styles['chat-model-id']} ${styles['chat-model-id-unset']}`}>
            <i className="fa-solid fa-circle-exclamation"></i>
            Not set up
          </span>
        ) : (
          <span className={styles['chat-model-id']}>{shortModel}</span>
        )}
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: '10px', opacity: 0.7 }}></i>
      </button>

      {open && (
        <div className={`${styles['chat-model-menu']} animate-fadeIn`}>
          {/* First-run / unconfigured callout */}
          {notSetUp && !switchingProvider && (
            <div className={styles['chat-model-setup-note']} role="status">
              <i className="fa-solid fa-circle-exclamation"></i>
              <span>
                {setup?.issue === 'no-credential'
                  ? `No ${PROVIDER_LABEL[provider] || provider} credential is configured.`
                  : 'Pick a model to use so chats can start.'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new CustomEvent('boz_open_settings', { detail: { tab: 'providers' } }));
                }}
              >
                Set up
              </button>
            </div>
          )}

          {/* Provider switcher */}
          {switchingProvider ? (
            <>
              <div className={styles['chat-model-menu-label']}>Switch provider</div>
              {PROVIDER_ORDER.map((pid) => (
                <button
                  key={pid}
                  type="button"
                  className={`${styles['chat-model-option']}${pid === provider ? ' active' : ''}`}
                  onClick={() => switchProvider(pid)}
                  disabled={saving}
                >
                  <span>{PROVIDER_LABEL[pid] || pid}</span>
                  {pid === provider && <i className="fa-solid fa-check" style={{ fontSize: '11px' }}></i>}
                </button>
              ))}
              <button
                type="button"
                className={styles['chat-model-settings']}
                onClick={() => setSwitchingProvider(false)}
              >
                ← Back to models
              </button>
            </>
          ) : (
            <>
              <div className={styles['chat-model-menu-label']} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
              <div className={styles['chat-model-search-box']}>
                <i className={`fa-solid fa-magnifying-glass ${styles['chat-model-search-icon']}`}></i>
                <input
                  ref={searchInputRef}
                  type="text"
                  className={styles['chat-model-search-input']}
                  placeholder="Search models..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (filteredModels.length > 0) {
                        void applyModel(provider, filteredModels[0].id);
                      } else if (searchQuery.trim()) {
                        void applyModel(provider, searchQuery.trim());
                      }
                    }
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className={styles['chat-model-search-clear']}
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
              <div className={styles['chat-model-list']}>
                {filteredModels.length === 0 && listed.length > 0 && searching && (
                  <div className={styles['chat-model-empty']}>
                    No models matching &ldquo;{searchQuery}&rdquo;
                  </div>
                )}

                {filteredModels.length === 0 && listed.length === 0 && provider !== 'custom' && (
                  <div className={styles['chat-model-empty']}>No models listed for this provider.</div>
                )}

                {searching
                  ? modelRows(filteredModels)
                  : <>
                      {modelRows(ungrouped)}
                      {groups.map((group) => (
                        <div key={group.prefix} className={styles['chat-model-group']}>
                          <button
                            type="button"
                            className={styles['chat-model-folder']}
                            onClick={() => toggleFolder(group.prefix)}
                            aria-expanded={expandedFolders.includes(group.prefix)}
                          >
                            <i
                              className={`fa-solid ${expandedFolders.includes(group.prefix) ? 'fa-folder-open' : 'fa-folder'}`}
                              style={{ fontSize: '11px', opacity: 0.75, width: '13px' }}
                            ></i>
                            <span className={styles['chat-model-folder-name']}>{group.prefix}</span>
                            <span className={styles['chat-model-folder-count']}>{group.models.length}</span>
                            <i
                              className={`fa-solid fa-chevron-${expandedFolders.includes(group.prefix) ? 'up' : 'down'}`}
                              style={{ fontSize: '9px', opacity: 0.5 }}
                            ></i>
                          </button>
                          {expandedFolders.includes(group.prefix) && (
                            <div className={styles['chat-model-folder-items']}>
                              {modelRows(group.models)}
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                }
              </div>

              {provider === 'custom' && (
                <form
                  className={styles['chat-model-custom-row']}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void applyModel('custom', customDraft || searchQuery);
                  }}
                >
                  <input
                    type="text"
                    value={customDraft}
                    onChange={(e) => setCustomDraft(e.target.value)}
                    placeholder="Type custom model ID"
                    className={styles['chat-model-custom-input']}
                  />
                  <button type="submit" disabled={saving || (!customDraft.trim() && !searchQuery.trim())} className={styles['chat-model-custom-btn']}>
                    Use
                  </button>
                </form>
              )}

              <button
                type="button"
                className={styles['chat-model-settings']}
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
