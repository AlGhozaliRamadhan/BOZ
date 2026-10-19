'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  DEFAULT_SHELL_PREFERENCES,
  readShellPreferences,
  writeShellPreferences,
  type ShellPreferences,
  type UiDensity,
  type ChatTextSize,
  type BozFont,
  type MotionPreference,
} from '../layout/shell-state';
import {
  readTheme,
  writeTheme,
  applyTheme,
  type Theme,
} from '../layout/theme-state';
import {
  DEFAULT_PROFILE,
  PROFILE_AVATAR_COLORS,
  PROFILE_EVENT,
  profileInitial,
  readProfile,
  writeProfile,
} from '../layout/profile-state';

interface SettingsConfig {
  provider: string;
  model: string;
  endpoint: string;
  ticker: string;
  riskMode: string;
  profileAbout: string;
  hasGithubToken: boolean;
  hasNvidiaKey: boolean;
  hasOpenaiKey: boolean;
  hasAnthropicKey: boolean;
  hasGroqKey: boolean;
  hasOpenrouterKey: boolean;
  hasCustomKey: boolean;
  offlineUrl: string;
  customUrl: string;
  availableModels: { id: string; label: string }[];
  allModels?: { id: string; label: string; provider?: string }[];
}

type IntegrationProviderId =
  | 'github'
  | 'nvidia'
  | 'offline'
  | 'custom'
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'openrouter';
type CredentialProviderId = Exclude<IntegrationProviderId, 'offline'>;

interface ConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

const ProviderIcon = ({ id, name }: { id: string; name: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={`/providers/${id === 'offline' ? 'ollama' : id}.svg`}
    alt={`${name} logo`}
    width={26}
    height={26}
    loading="lazy"
    style={{ width: '26px', height: '26px', objectFit: 'contain', flexShrink: 0, filter: 'brightness(0) invert(1)', opacity: 0.9 }}
    onError={(e) => {
      (e.target as HTMLImageElement).style.display = 'none';
    }}
  />
);

const ALL_PROVIDERS = [
  {
    id: 'github',
    name: 'GitHub Models',
    description: 'GitHub-hosted AI models with free tier access',
    icon: <ProviderIcon id="github" name="GitHub Models" />,
    available: true,
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    description: 'High-performance inference with NVIDIA hardware acceleration',
    icon: <ProviderIcon id="nvidia" name="NVIDIA NIM" />,
    available: true,
  },
  {
    id: 'custom',
    name: '9router',
    description: 'Your OpenAI-compatible local router or gateway',
    icon: <ProviderIcon id="custom" name="9router" />,
    available: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models through the official OpenAI API',
    icon: <ProviderIcon id="openai" name="OpenAI" />,
    available: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models through the official Messages API',
    icon: <ProviderIcon id="anthropic" name="Anthropic" />,
    available: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Fast OpenAI-compatible inference from GroqCloud',
    icon: <ProviderIcon id="groq" name="Groq" />,
    available: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'One OpenAI-compatible API for hundreds of models',
    icon: <ProviderIcon id="openrouter" name="OpenRouter" />,
    available: true,
  },
  {
    id: 'offline',
    name: 'Ollama',
    description: 'Private, Ollama-compatible inference running on your machine',
    icon: <ProviderIcon id="offline" name="Ollama" />,
    available: true,
  },
] as const satisfies readonly {
  id: IntegrationProviderId;
  name: string;
  description: string;
  icon: React.ReactNode;
  available: boolean;
}[];

const ModelBadge = ({
  modelName,
  isActiveProvider,
  isSelected,
  onSelect,
}: {
  modelName: string;
  isActiveProvider: boolean;
  isSelected: boolean;
  onSelect: () => void;
}) => {
  const [hovered, setHovered] = useState(false);
  const [status, setStatus] = useState<'idle'|'loading'|'success'|'error'>('idle');

  return (
    <div 
      onMouseEnter={() => setHovered(true)} 
      onMouseLeave={() => setHovered(false)}
      style={{ 
        display: 'flex', alignItems: 'center', gap: '6px',
        background: isSelected ? 'var(--text-primary)' : 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.1)',
        color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: '4px', 
        fontSize: '11px', fontWeight: 500, userSelect: 'none', transition: 'all 0.15s', cursor: 'pointer'
      }}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      {status !== 'idle' && (
        <i className={`fa-solid ${status === 'loading' ? 'fa-circle-notch fa-spin' : status === 'success' ? 'fa-check' : 'fa-xmark'}`} 
           style={{ color: status === 'success' ? 'var(--bull)' : status === 'error' ? 'var(--bear)' : 'var(--text-muted)' }}>
        </i>
      )}
      
      <span style={{ color: isSelected ? 'var(--bg-primary)' : undefined }}>{modelName}</span>
      
      {hovered && (
        <div style={{ display: 'flex', gap: '6px', marginLeft: '4px', borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '6px' }}>
          <button 
            onClick={(event) => { event.stopPropagation(); navigator.clipboard.writeText(modelName); }}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            title="Copy Model Name"
          >
            <i className="fa-regular fa-copy"></i>
          </button>
          
          <button 
            onClick={async (event) => {
              event.stopPropagation();
              if (!isActiveProvider) { alert('You must set this as your Active Provider to test its models.'); return; }
              setStatus('loading');
              try {
                const res = await fetch('/api/chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ message: "hi", model: modelName })
                });
                if (!res.ok) throw new Error();
                setStatus('success');
              } catch {
                setStatus('error');
              }
            }}
            disabled={status === 'loading'}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            title="Ping Model with 'hi'"
          >
            <i className="fa-solid fa-play"></i>
          </button>
        </div>
      )}
    </div>
  );
};

import type { SettingsTab } from '../layout/shell-commands';

export type { SettingsTab };

/** One settings row: label + description on the left, control on the right.
 *
 * The stacked variant places the control under the label, full width, for
 * wider controls such as segmented buttons. */
function SettingRow({ title, description, children, last = false, stacked = false }: {
  title: string;
  description: string;
  children: React.ReactNode;
  last?: boolean;
  stacked?: boolean;
}) {
  const border = last ? 'none' : '1px solid rgba(255,255,255,0.05)';
  if (stacked) {
    return (
      <div style={{ padding: '16px 0', borderBottom: border }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{description}</div>
        <div style={{ marginTop: '12px' }}>{children}</div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: border, gap: '16px' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>{title}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{description}</div>
      </div>
      {children}
    </div>
  );
}

/** Styled listbox dropdown for the appearance controls.
 *
 * A native <select> opens an OS-default popup that clashes with the modal,
 * so this renders the options itself: outside click and Escape dismiss, the
 * trigger keeps focus, and from there ArrowUp/ArrowDown walk the options
 * while Enter commits the highlighted one. Hovering moves the highlight. */
function ShellDropdown({ value, options, onChange, ariaLabel }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    // The highlight tracks the committed value each time the list opens.
    if (open) {
      const index = options.findIndex((option) => option.value === value);
      setActiveIndex(index === -1 ? 0 : index);
    }
  }, [open, value, options]);

  const commit = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (!open) {
            if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault();
              setOpen(true);
            }
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => Math.min(options.length - 1, current + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => Math.max(0, current - 1));
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const option = options[activeIndex];
            if (option) commit(option.value);
          }
        }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
          minWidth: '150px', padding: '8px 12px', borderRadius: '8px', textAlign: 'left',
          background: hovered || open ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.05)',
          border: open ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.12)',
          color: 'var(--text-primary)', fontSize: '13px', cursor: 'pointer', outline: 'none',
          transition: 'background 0.15s ease, border-color 0.15s ease',
        }}
      >
        <span style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{selected?.label}</span>
        <i
          className="fa-solid fa-chevron-down"
          aria-hidden="true"
          style={{
            fontSize: '9px', opacity: open ? 1 : 0.6, flexShrink: 0,
            transition: 'transform 0.15s ease', transform: open ? 'rotate(180deg)' : 'none',
          }}
        ></i>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, minWidth: '100%',
            background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: '10px', padding: '4px', overflow: 'hidden', zIndex: 60,
            boxShadow: '0 14px 34px -10px rgba(0,0,0,0.6)',
          }}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <div
                key={option.value}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(option.value)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                  padding: '8px 10px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  background: isActive ? 'rgba(255,255,255,0.07)' : 'transparent',
                  color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: isSelected ? 600 : 400,
                  transition: 'background 0.12s ease',
                }}
              >
                <span>{option.label}</span>
                {isSelected && <i className="fa-solid fa-check" aria-hidden="true" style={{ fontSize: '10px' }}></i>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Segmented control: a row of pill options where the current pick is
 * outlined and raised. Used for the appearance toggles with a small, fixed
 * option set where a dropdown would hide a one-click choice. */
function SegmentedControl({ value, options, onChange, ariaLabel }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex', padding: '3px', gap: '2px', maxWidth: '100%',
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '10px',
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => { if (!selected) onChange(option.value); }}
            style={{
              padding: '6px 14px', borderRadius: '7px', fontSize: '12.5px', cursor: 'pointer',
              border: selected ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
              background: selected ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: selected ? 600 : 500,
              whiteSpace: 'nowrap',
              transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Labels for the BOZ font voices shown in the font picker and toasts. */
const FONT_LABELS: Record<BozFont, string> = {
  serif: 'BOZ Serif',
  sans: 'BOZ Sans',
  mono: 'BOZ Mono',
};

export default function SettingsModal({ isOpen, initialTab = 'profile', onClose }: { isOpen: boolean, initialTab?: SettingsTab, onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [config, setConfig] = useState<SettingsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>('dark');
  const [tickerVisible, setTickerVisible] = useState(DEFAULT_SHELL_PREFERENCES.tickerVisible);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(DEFAULT_SHELL_PREFERENCES.sidebarCollapsed);
  const [density, setDensityState] = useState<UiDensity>(DEFAULT_SHELL_PREFERENCES.density);
  const [chatText, setChatTextState] = useState<ChatTextSize>(DEFAULT_SHELL_PREFERENCES.chatText);
  const [font, setFontState] = useState<BozFont>(DEFAULT_SHELL_PREFERENCES.font);
  const [motion, setMotionState] = useState<MotionPreference>(DEFAULT_SHELL_PREFERENCES.motion);
  const [defaultTicker, setDefaultTicker] = useState('');
  const [tickerNote, setTickerNote] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState('http://localhost:20128/v1');
  const [offlineUrl, setOfflineUrl] = useState('http://localhost:11434');
  const [customKey, setCustomKey] = useState('');
  const [customModels, setCustomModels] = useState<{ id: string; label: string }[]>([]);
  const [customModelDraft, setCustomModelDraft] = useState('');
  const [fetchingCustomModels, setFetchingCustomModels] = useState(false);
  const [displayName, setDisplayName] = useState(DEFAULT_PROFILE.displayName);
  const [statusLine, setStatusLine] = useState('');
  const [avatarColor, setAvatarColor] = useState(DEFAULT_PROFILE.avatarColor);
  const [profileAbout, setProfileAbout] = useState('');
  const [credentialDrafts, setCredentialDrafts] = useState<Record<CredentialProviderId, string>>({
    github: '',
    nvidia: '',
    custom: '',
    openai: '',
    anthropic: '',
    groq: '',
    openrouter: '',
  });
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to load settings');
      const data = await res.json();
      setConfig(data);
      setTheme(readTheme(window.localStorage));
      try {
        const shell = readShellPreferences(window.localStorage);
        setTickerVisible(shell.tickerVisible);
        setSidebarCollapsed(shell.sidebarCollapsed);
      } catch {
        setTickerVisible(DEFAULT_SHELL_PREFERENCES.tickerVisible);
        setSidebarCollapsed(DEFAULT_SHELL_PREFERENCES.sidebarCollapsed);
      }
      setCustomUrl(data.customUrl || 'http://localhost:20128/v1');
      setOfflineUrl(data.offlineUrl || 'http://localhost:11434');
      setCustomKey('');
      const storedProfile = readProfile(window.localStorage);
      setDisplayName(storedProfile.displayName);
      setStatusLine(storedProfile.status);
      setAvatarColor(storedProfile.avatarColor);
      setProfileAbout(typeof data.profileAbout === 'string' ? data.profileAbout : '');
      setCustomModels(Array.isArray(data.availableModels) && data.provider === 'custom'
        ? data.availableModels
        : (data.allModels || []).filter((m: { provider?: string }) => m.provider === 'custom'));
      // Visual scales + chat-knob state load with the rest of the modal.
      const storedShell = readShellPreferences(window.localStorage);
      setDensityState(storedShell.density);
      setChatTextState(storedShell.chatText);
      setFontState(storedShell.font);
      setMotionState(storedShell.motion);
      if (typeof data.ticker === 'string') setDefaultTicker(data.ticker);

      setCredentialDrafts({
        github: '',
        nvidia: '',
        custom: '',
        openai: '',
        anthropic: '',
        groq: '',
        openrouter: '',
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
      setSearchQuery('');
      setActiveTab(initialTab);
    }
  }, [isOpen, fetchSettings, initialTab]);

  useEffect(() => {
    // Remove credentials persisted by releases before the write-only settings API.
    localStorage.removeItem('boz_provider_keys');
  }, []);

  // Reflect theme changes made elsewhere.
  useEffect(() => {
    const sync = () => {
      try {
        setTheme(readTheme(window.localStorage));
      } catch {
        // Keep last known theme when storage is unavailable.
      }
    };
    window.addEventListener('boz_theme_changed', sync);
    return () => window.removeEventListener('boz_theme_changed', sync);
  }, []);

  const showToast = (msg: string) => {
    setSaveMessage(msg);
    setTimeout(() => setSaveMessage(null), 3000);
  };

  // Persists an Appearance change and hands it to the shell, which owns the
  // DOM-wide zoom variables; dispatch beats prop-drilling through pages.
  const saveShellVisuals = (patch: { density?: UiDensity; chatText?: ChatTextSize; font?: BozFont; motion?: MotionPreference }) => {
    const next: ShellPreferences = {
      sidebarCollapsed,
      tickerVisible,
      density: patch.density ?? density,
      chatText: patch.chatText ?? chatText,
      font: patch.font ?? font,
      motion: patch.motion ?? motion,
    };
    try {
      writeShellPreferences(window.localStorage, next);
    } catch {
      // Layout prefs are optional.
    }
    if (patch.density !== undefined) setDensityState(patch.density);
    if (patch.chatText !== undefined) setChatTextState(patch.chatText);
    if (patch.font !== undefined) setFontState(patch.font);
    if (patch.motion !== undefined) setMotionState(patch.motion);
    window.dispatchEvent(new Event('boz_shell_updated'));
  };

  // Ticker save is validated server-side (symbol directory); a rejection is
  // surfaced inline next to the field rather than only as a toast.
  const saveDefaultTicker = async (): Promise<void> => {
    const symbol = defaultTicker.trim();
    const ok = await updateConfig({ ticker: symbol }, symbol ? 'Default ticker saved' : 'Default ticker cleared');
    if (!ok) setTickerNote('Unknown ticker. Check the symbol (e.g. NVDA, BTC-USD, ^GSPC).');
  };

  const updateConfig = async (payload: Record<string, unknown>, successMsg: string): Promise<boolean> => {
    setSaving(true);
    setError(null);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update');
      setConfig(data);
      window.dispatchEvent(new Event('boz_settings_updated'));
      showToast(successMsg);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const credentialField: Record<CredentialProviderId, string> = {
    github: 'githubToken',
    nvidia: 'nvidiaKey',
    custom: 'customKey',
    openai: 'openaiKey',
    anthropic: 'anthropicKey',
    groq: 'groqKey',
    openrouter: 'openrouterKey',
  };

  const credentialConfigured = (providerId: CredentialProviderId) => {
    const configured: Record<CredentialProviderId, boolean> = {
      github: Boolean(config?.hasGithubToken),
      nvidia: Boolean(config?.hasNvidiaKey),
      custom: Boolean(config?.hasCustomKey),
      openai: Boolean(config?.hasOpenaiKey),
      anthropic: Boolean(config?.hasAnthropicKey),
      groq: Boolean(config?.hasGroqKey),
      openrouter: Boolean(config?.hasOpenrouterKey),
    };
    return configured[providerId];
  };

  const saveCredential = async (providerId: CredentialProviderId) => {
    const value = providerId === 'custom' ? customKey.trim() : credentialDrafts[providerId].trim();
    if (!value) {
      setError('Enter a credential before saving it.');
      return;
    }
    const saved = await updateConfig({ [credentialField[providerId]]: value }, 'Credential saved securely on the server');
    if (saved) {
      if (providerId === 'custom') setCustomKey('');
      else setCredentialDrafts((current) => ({ ...current, [providerId]: '' }));
    }
  };

  const clearCredential = async (providerId: CredentialProviderId) => {
    const cleared = await updateConfig({ [credentialField[providerId]]: '' }, 'Credential removed');
    if (cleared) {
      if (providerId === 'custom') setCustomKey('');
      else setCredentialDrafts((current) => ({ ...current, [providerId]: '' }));
    }
  };

  const saveProfile = () => {
    const name = displayName.trim().replace(/[\r\n\0]/g, '').slice(0, 32) || DEFAULT_PROFILE.displayName;
    const status = statusLine.trim().replace(/[\r\n\0]/g, '').slice(0, 60);
    const color = (PROFILE_AVATAR_COLORS as readonly string[]).includes(avatarColor)
      ? avatarColor
      : DEFAULT_PROFILE.avatarColor;
    setDisplayName(name);
    setStatusLine(status);
    setAvatarColor(color);
    writeProfile(window.localStorage, { displayName: name, status, avatarColor: color });
    window.dispatchEvent(new Event(PROFILE_EVENT));
    showToast('Profile saved');
  };

  const saveProfileAbout = async (value: string) => {
    const saved = await updateConfig({ profileAbout: value.trim() }, value.trim() ? 'Trading style saved' : 'Trading style cleared');
    if (saved) setProfileAbout(value.trim());
  };

  const saveCustomEndpoint = async () => {
    const url = customUrl.trim() || 'http://localhost:20128/v1';
    await updateConfig({ customUrl: url }, 'Custom endpoint saved');
  };

  const saveOfflineEndpoint = async () => {
    const url = offlineUrl.trim() || 'http://localhost:11434';
    await updateConfig({ offlineUrl: url }, 'Ollama endpoint saved');
  };

  const fetchCustomModels = async () => {
    setFetchingCustomModels(true);
    try {
      const res = await fetch('/api/custom-models');
      const data = await res.json();
      const models = Array.isArray(data.models) ? data.models : [];
      setCustomModels(models);
      if (models.length > 0) {
        await updateConfig(
          { customModels: models.map((m: { id: string }) => m.id) },
          `Loaded ${models.length} models from 9router`,
        );
      } else {
        showToast('No models returned. Add one below.');
      }
    } catch {
      setError('Could not reach 9router /models');
    } finally {
      setFetchingCustomModels(false);
    }
  };

  const addCustomModel = async (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    const next = customModels.some((m) => m.id === trimmed)
      ? customModels
      : [...customModels, { id: trimmed, label: trimmed }];
    setCustomModels(next);
    setCustomModelDraft('');
    await updateConfig({ customModels: next.map((m) => m.id), model: trimmed, provider: 'custom' }, `Model ${trimmed} saved`);
  };

  const testConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/test', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, message: 'Connection test failed' });
    } finally {
      setTestLoading(false);
    }
  };

  const filteredProviders = useMemo(() => {
    if (!searchQuery.trim()) return ALL_PROVIDERS;
    const q = searchQuery.toLowerCase();
    return ALL_PROVIDERS.filter(p => 
      p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(5px)',
      zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={onClose}>
      
      {/* Toast Notification */}
      {saveMessage && (
        <div style={{
          position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--text-primary)', color: 'var(--bg-primary)',
          padding: '8px 16px', borderRadius: 'var(--radius-full)',
          fontSize: '12px', fontWeight: 600, zIndex: 100000,
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
          display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          {saveMessage}
        </div>
      )}

      {/* Main Modal Window */}
      <div style={{
        background: 'var(--bg-elevated)', width: '100%', maxWidth: '900px', height: '85vh', minHeight: '680px',
        borderRadius: 'var(--radius-xl)', display: 'flex', overflow: 'hidden',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
      }} onClick={e => e.stopPropagation()}>
        
        {/* Sidebar */}
        <div style={{
          width: '240px', background: 'var(--bg-secondary)',
          borderRight: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ padding: '24px 24px 12px 24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Settings</h2>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', padding: '0 12px', gap: '4px' }}>
            <button
              onClick={() => setActiveTab('profile')}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px',
                borderRadius: '8px', cursor: 'pointer', border: 'none',
                background: activeTab === 'profile' ? 'var(--text-primary)' : 'transparent',
                color: activeTab === 'profile' ? 'var(--bg-primary)' : 'var(--text-secondary)',
                fontWeight: activeTab === 'profile' ? 600 : 500, fontSize: '13px',
                transition: 'all 0.15s ease'
              }}
            >
              <i className="fa-solid fa-user" style={{ fontSize: '14px' }}></i> Profile
            </button>

            <button
              onClick={() => setActiveTab('providers')}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px',
                borderRadius: '8px', cursor: 'pointer', border: 'none',
                background: activeTab === 'providers' ? 'var(--text-primary)' : 'transparent',
                color: activeTab === 'providers' ? 'var(--bg-primary)' : 'var(--text-secondary)',
                fontWeight: activeTab === 'providers' ? 600 : 500, fontSize: '13px',
                transition: 'all 0.15s ease'
              }}
            >
              <i className="fa-solid fa-cloud" style={{ fontSize: '14px' }}></i> Providers
            </button>

            <button
              onClick={() => setActiveTab('appearance')}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px',
                borderRadius: '8px', cursor: 'pointer', border: 'none',
                background: activeTab === 'appearance' ? 'var(--text-primary)' : 'transparent',
                color: activeTab === 'appearance' ? 'var(--bg-primary)' : 'var(--text-secondary)',
                fontWeight: activeTab === 'appearance' ? 600 : 500, fontSize: '13px',
                transition: 'all 0.15s ease'
              }}
            >
              <i className="fa-solid fa-palette" style={{ fontSize: '14px' }}></i> Appearance
            </button>

            <button 
              onClick={() => setActiveTab('general')}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px',
                borderRadius: '8px', cursor: 'pointer', border: 'none',
                background: activeTab === 'general' ? 'var(--text-primary)' : 'transparent',
                color: activeTab === 'general' ? 'var(--bg-primary)' : 'var(--text-secondary)',
                fontWeight: activeTab === 'general' ? 600 : 500, fontSize: '13px',
                transition: 'all 0.15s ease'
              }}
            >
              <i className="fa-solid fa-sliders" style={{ fontSize: '14px' }}></i> General
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflow: 'hidden' }}>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px' }}>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '8px', borderRadius: '50%' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          
          <div style={{ padding: '0 40px 40px 40px', overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', opacity: 0.5, fontSize: '13px' }}>Loading...</div>
            ) : error && !config ? (
              <div style={{ color: 'var(--danger)', fontSize: '13px' }}>{error}</div>
            ) : (
              <div style={{ maxWidth: '600px' }}>
                
                {activeTab === 'profile' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Profile</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                        Your display name and avatar live in this browser only. Your trading style is stored on this device and sent with chat requests.
                      </p>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', marginBottom: '20px' }}>
                        <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '18px', fontWeight: 700, flexShrink: 0 }}>
                          {profileInitial(displayName) || <i className="fa-solid fa-user" style={{ fontSize: '16px' }}></i>}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {displayName.trim() || 'User'}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {statusLine.trim() || 'No status set'}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>Display name</label>
                          <input
                            type="text"
                            value={displayName}
                            maxLength={32}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="User"
                            style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>Status (optional)</label>
                          <input
                            type="text"
                            value={statusLine}
                            maxLength={60}
                            onChange={(e) => setStatusLine(e.target.value)}
                            placeholder="Swing trader · IDX"
                            style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>Avatar color</label>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {PROFILE_AVATAR_COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => setAvatarColor(color)}
                                aria-label={`Avatar color ${color}`}
                                title={color}
                                style={{
                                  width: '32px', height: '32px', borderRadius: '50%', background: color, cursor: 'pointer',
                                  border: avatarColor === color ? '2px solid var(--text-primary)' : '2px solid transparent',
                                  outline: avatarColor === color ? '2px solid rgba(255,255,255,0.3)' : 'none',
                                  outlineOffset: '2px',
                                }}
                              />
                            ))}
                          </div>
                        </div>
                        <div>
                          <button
                            onClick={saveProfile}
                            style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', padding: '9px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                          >
                            Save profile
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Trading style</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                        One line about you that the chat agent reads before answering (e.g. “Conservative swing trader, avoids leverage”). Max 500 characters.
                      </p>
                      <textarea
                        value={profileAbout}
                        maxLength={500}
                        rows={3}
                        onChange={(e) => setProfileAbout(e.target.value)}
                        placeholder="Tell BOZ how you trade…"
                        style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                      />
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{profileAbout.length}/500</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {profileAbout.trim() && (
                            <button
                              onClick={() => saveProfileAbout('')}
                              disabled={saving}
                              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--danger)', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                            >
                              Clear
                            </button>
                          )}
                          <button
                            onClick={() => saveProfileAbout(profileAbout)}
                            disabled={saving}
                            style={{ background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Preferences</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Quick links to related settings.</p>
                      <button
                        onClick={() => setActiveTab('providers')}
                        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                      >
                        AI providers
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'providers' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Integrations</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>
                        Configure hosted, routed, or local models. Credentials are write-only and stay on this device.
                      </p>

                      {error && (
                        <div role="alert" style={{ marginBottom: '16px', padding: '10px 12px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.35)', color: 'var(--danger)', fontSize: '12px' }}>
                          {error}
                        </div>
                      )}
                      
                      {/* Search Bar */}
                      <div style={{ marginBottom: '16px', position: 'relative' }}>
                        <i className="fa-solid fa-search" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '12px' }}></i>
                        <input
                          type="text"
                          placeholder="Search OpenAI, Anthropic, Groq, OpenRouter..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          style={{
                            width: '100%', background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: 'var(--text-primary)', padding: '10px 12px 10px 36px', borderRadius: '8px', fontSize: '13px', outline: 'none',
                            transition: 'border-color 0.2s'
                          }}
                        />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {filteredProviders.map(p => {
                          const isExpanded = expandedProvider === p.id;
                          const isActiveProvider = config?.provider === p.id;
                          const providerModels = (config?.allModels || [])
                            .filter((model) => model.provider === p.id)
                            .filter((model, index, models) => models.findIndex((candidate) => candidate.id === model.id) === index);
                          
                          return (
                            <div 
                              key={p.id}
                              style={{
                                display: 'flex', flexDirection: 'column', borderRadius: '12px',
                                border: `1px solid ${isExpanded ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)'}`,
                                background: isExpanded ? 'rgba(255, 255, 255, 0.03)' : 'transparent',
                                transition: 'all 0.2s ease', overflow: 'hidden',
                                opacity: p.available ? 1 : 0.6
                              }}
                            >
                              <div 
                                onClick={() => setExpandedProvider(isExpanded ? null : p.id)}
                                style={{ display: 'flex', alignItems: 'center', padding: '16px', cursor: 'pointer', gap: '16px' }}
                              >
                                <div style={{ color: isActiveProvider ? 'var(--text-primary)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px' }}>{p.icon}</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: '14px', fontWeight: 600, color: isActiveProvider ? 'var(--text-primary)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {p.name}
                                    {isActiveProvider && <span style={{ border: '1px solid rgba(34, 197, 94, 0.35)', color: 'var(--bull)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase' }}>Active</span>}
                                  </div>
                                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{p.description}</div>
                                </div>
                                <div style={{ color: 'var(--text-muted)' }}>
                                  <i className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                                </div>
                              </div>
                              
                              {/* Expanded Content Area */}
                              {isExpanded && p.available && (
                                <div style={{ padding: '20px 16px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', background: 'rgba(0, 0, 0, 0.2)' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                    
                                    {p.id === 'custom' && (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div>
                                          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>Endpoint</label>
                                          <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                              type="text"
                                              value={customUrl}
                                              onChange={(e) => setCustomUrl(e.target.value)}
                                              placeholder="http://localhost:20128/v1"
                                              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }}
                                            />
                                            <button
                                              onClick={saveCustomEndpoint}
                                              disabled={saving}
                                              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                                            >
                                              Save
                                            </button>
                                          </div>
                                        </div>
                                        <div>
                                          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                                            API Key (optional) · {credentialConfigured('custom') ? 'configured' : 'not configured'}
                                          </label>
                                          <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                              type="password"
                                              value={customKey}
                                              onChange={(e) => setCustomKey(e.target.value)}
                                              autoComplete="new-password"
                                              placeholder={credentialConfigured('custom') ? 'Enter a replacement key' : 'Leave blank if the provider does not require a key'}
                                              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }}
                                            />
                                            <button
                                              onClick={() => saveCredential('custom')}
                                              disabled={saving || !customKey.trim()}
                                              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                                            >
                                              Save Key
                                            </button>
                                            {credentialConfigured('custom') && (
                                              <button
                                                onClick={() => clearCredential('custom')}
                                                disabled={saving}
                                                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--danger)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                                              >
                                                Clear
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                        <div>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                            <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>Models</label>
                                            <button
                                              onClick={fetchCustomModels}
                                              disabled={fetchingCustomModels}
                                              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}
                                            >
                                              {fetchingCustomModels ? 'Loading...' : 'Fetch /v1/models'}
                                            </button>
                                          </div>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                                            {customModels.length === 0 ? (
                                              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No models yet. Fetch from 9router or add one.</span>
                                            ) : customModels.map((m) => (
                                              <button
                                                key={m.id}
                                                onClick={() => updateConfig({ provider: 'custom', model: m.id }, `${m.id} set as active`)}
                                                style={{
                                                  background: config?.model === m.id ? 'var(--text-primary)' : 'rgba(255,255,255,0.04)',
                                                  color: config?.model === m.id ? 'var(--bg-primary)' : 'var(--text-secondary)',
                                                  border: '1px solid rgba(255,255,255,0.1)',
                                                  padding: '4px 8px',
                                                  borderRadius: '4px',
                                                  fontSize: '11px',
                                                  cursor: 'pointer',
                                                }}
                                              >
                                                {m.id}
                                              </button>
                                            ))}
                                          </div>
                                          <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                              type="text"
                                              value={customModelDraft}
                                              onChange={(e) => setCustomModelDraft(e.target.value)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                  e.preventDefault();
                                                  addCustomModel(customModelDraft);
                                                }
                                              }}
                                              placeholder="Add model id, then Enter"
                                              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }}
                                            />
                                            <button
                                              onClick={() => addCustomModel(customModelDraft)}
                                              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                                            >
                                              Add
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    )}

                                    {p.id === 'offline' && (
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        <div>
                                          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>Ollama endpoint</label>
                                          <div style={{ display: 'flex', gap: '8px' }}>
                                            <input
                                              type="url"
                                              value={offlineUrl}
                                              onChange={(event) => setOfflineUrl(event.target.value)}
                                              placeholder="http://localhost:11434"
                                              spellCheck={false}
                                              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }}
                                            />
                                            <button
                                              onClick={saveOfflineEndpoint}
                                              disabled={saving}
                                              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                                            >
                                              Save
                                            </button>
                                          </div>
                                          <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: '8px 0 0' }}>
                                            This stays on your machine by default and does not require an API key.
                                          </p>
                                        </div>
                                      </div>
                                    )}

                                    {/* Credentials are write-only and remain server-side. */}
                                    {p.id !== 'custom' && p.id !== 'offline' && (
                                    <div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>
                                          API Credential · {credentialConfigured(p.id as CredentialProviderId) ? 'configured' : 'not configured'}
                                        </label>
                                      </div>
                                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <input
                                          type="password"
                                          value={credentialDrafts[p.id as CredentialProviderId]}
                                          onChange={(e) => setCredentialDrafts((current) => ({ ...current, [p.id]: e.target.value }))}
                                          autoComplete="new-password"
                                          placeholder={credentialConfigured(p.id as CredentialProviderId) ? 'Enter a replacement credential' : 'Enter API credential'}
                                          style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '12px', outline: 'none', fontFamily: 'monospace' }}
                                        />
                                        <button
                                          onClick={() => saveCredential(p.id as CredentialProviderId)}
                                          disabled={saving || !credentialDrafts[p.id as CredentialProviderId].trim()}
                                          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: '11px', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer' }}
                                        >
                                          Save
                                        </button>
                                        {credentialConfigured(p.id as CredentialProviderId) && (
                                          <button
                                            onClick={() => clearCredential(p.id as CredentialProviderId)}
                                            disabled={saving}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px' }}
                                            title="Remove credential"
                                          >
                                            <i className="fa-solid fa-trash-can"></i>
                                          </button>
                                        )}
                                      </div>
                                      <p style={{ color: 'var(--text-muted)', fontSize: '11px', margin: '8px 0 0' }}>
                                        Saved credentials are never returned to or persisted by the browser.
                                      </p>
                                    </div>
                                    )}

                                    {/* Supported Models Badges */}
                                    {p.id !== 'custom' && providerModels.length > 0 && (
                                      <div style={{ marginTop: '8px' }}>
                                        <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, margin: '0 0 8px 0', display: 'block', textTransform: 'uppercase' }}>Select a model</label>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                          {providerModels.map((model) => (
                                            <ModelBadge
                                              key={model.id}
                                              modelName={model.id}
                                              isActiveProvider={isActiveProvider}
                                              isSelected={isActiveProvider && config?.model === model.id}
                                              onSelect={() => updateConfig({ provider: p.id, model: model.id }, `${model.id} set as active`)}
                                            />
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* Actions */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '16px' }}>
                                      {!isActiveProvider && (
                                        <button 
                                          onClick={() => updateConfig({ provider: p.id }, `${p.name} activated`)}
                                          disabled={saving}
                                          style={{
                                            background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none',
                                            padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer'
                                          }}
                                        >
                                          Set as Active Provider
                                        </button>
                                      )}
                                      
                                      <button
                                        onClick={testConnection}
                                        disabled={testLoading || !isActiveProvider}
                                        style={{ 
                                          background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', 
                                          color: 'var(--text-primary)', padding: '8px 16px', borderRadius: '6px', 
                                          fontSize: '13px', fontWeight: 600, cursor: isActiveProvider ? 'pointer' : 'not-allowed',
                                          opacity: isActiveProvider ? 1 : 0.5,
                                          transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '8px'
                                        }}
                                        title={!isActiveProvider ? "Must be active provider to test connection" : ""}
                                      >
                                        {testLoading ? <><i className="fa-solid fa-spinner fa-spin"></i> Checking...</> : 'Ping API'}
                                      </button>
                                    </div>

                                    {isActiveProvider && testResult && (
                                      <p role="status" style={{ margin: 0, color: testResult.success ? 'var(--bull)' : 'var(--danger)', fontSize: '12px' }}>
                                        {testResult.success ? <i className="fa-solid fa-check" style={{ marginRight: '6px' }} /> : <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: '6px' }} />}
                                        {testResult.message}{testResult.latencyMs !== undefined ? ` (${testResult.latencyMs} ms)` : ''}
                                      </p>
                                    )}

                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'appearance' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Looks</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Fonts, theme, spacing, and motion. Applies immediately.</p>

                      <SettingRow
                        title="Theme"
                        description="Dark is the default terminal look; light is easy on the eyes."
                      >
                        <ShellDropdown
                          ariaLabel="Theme"
                          value={theme}
                          options={[
                            { value: 'dark', label: 'Dark' },
                            { value: 'light', label: 'Light' },
                          ]}
                          onChange={(next) => {
                            const themeNext = next === 'light' ? 'light' : 'dark';
                            setTheme(themeNext);
                            try {
                              writeTheme(window.localStorage, themeNext);
                            } catch {
                              // Theme just won't persist when storage is unavailable.
                            }
                            applyTheme(themeNext);
                            window.dispatchEvent(new Event('boz_theme_changed'));
                            showToast(themeNext === 'light' ? 'Light theme on' : 'Dark theme on');
                          }}
                        />
                      </SettingRow>

                      <SettingRow
                        title="Font"
                        description="BOZ Serif is the default voice. Sans is the classic app look; Mono reads terminal."
                      >
                        <ShellDropdown
                          ariaLabel="Font"
                          value={font}
                          options={(Object.keys(FONT_LABELS) as BozFont[]).map((key) => ({ value: key, label: FONT_LABELS[key] }))}
                          onChange={(next) => {
                            const fontNext = (['serif', 'sans', 'mono'].includes(next) ? next : 'serif') as BozFont;
                            saveShellVisuals({ font: fontNext });
                            showToast(`Font set to ${FONT_LABELS[fontNext]}`);
                          }}
                        />
                      </SettingRow>

                      <SettingRow
                        stacked
                        title="Chat text size"
                        description="Scales text inside the chat surface: bubbles, composer input, and transcripts."
                      >
                        <SegmentedControl
                          ariaLabel="Chat text size"
                          value={chatText}
                          options={[
                            { value: 'small', label: 'Small' },
                            { value: 'medium', label: 'Medium' },
                            { value: 'large', label: 'Large' },
                          ]}
                          onChange={(next) => {
                            const sizeNext = (['small', 'medium', 'large'].includes(next) ? next : 'medium') as ChatTextSize;
                            saveShellVisuals({ chatText: sizeNext });
                            showToast(`Chat text: ${sizeNext}`);
                          }}
                        />
                      </SettingRow>

                      <SettingRow
                        stacked
                        title="Interface density"
                        description="Compact shrinks the sidebar and chat surface to fit more on screen."
                      >
                        <SegmentedControl
                          ariaLabel="Interface density"
                          value={density}
                          options={[
                            { value: 'comfortable', label: 'Comfortable' },
                            { value: 'compact', label: 'Compact' },
                          ]}
                          onChange={(next) => {
                            saveShellVisuals({ density: next === 'compact' ? 'compact' : 'comfortable' });
                            showToast(next === 'compact' ? 'Compact density' : 'Comfortable density');
                          }}
                        />
                      </SettingRow>

                      <SettingRow
                        stacked
                        last
                        title="Motion"
                        description="Reduced stops animations and transitions. System follows your OS setting."
                      >
                        <SegmentedControl
                          ariaLabel="Motion"
                          value={motion}
                          options={[
                            { value: 'system', label: 'System' },
                            { value: 'reduced', label: 'Reduced' },
                          ]}
                          onChange={(next) => {
                            saveShellVisuals({ motion: next === 'reduced' ? 'reduced' : 'system' });
                            showToast(next === 'reduced' ? 'Motion reduced' : 'Motion follows system');
                          }}
                        />
                      </SettingRow>
                    </div>
                  </div>
                )}

                {activeTab === 'general' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Layout</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Shell chrome around the workspace.</p>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Market ticker tape</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Scrolling quotes strip above the workspace.</div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={tickerVisible}
                          onClick={() => {
                            const next = !tickerVisible;
                            setTickerVisible(next);
                            try {
                              writeShellPreferences(window.localStorage, {
                                sidebarCollapsed,
                                tickerVisible: next,
                                density,
                                chatText,
                                font,
                                motion,
                              });
                            } catch {
                              // Layout prefs are optional.
                            }
                            window.dispatchEvent(new Event('boz_shell_updated'));
                            showToast(next ? 'Ticker tape shown' : 'Ticker tape hidden');
                          }}
                          style={{
                            background: tickerVisible ? 'var(--text-primary)' : 'rgba(255, 255, 255, 0.08)',
                            color: tickerVisible ? 'var(--bg-primary)' : 'var(--text-secondary)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          {tickerVisible ? 'On' : 'Off'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Reset layout</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Restore sidebar and ticker tape defaults.</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setTickerVisible(DEFAULT_SHELL_PREFERENCES.tickerVisible);
                            setSidebarCollapsed(DEFAULT_SHELL_PREFERENCES.sidebarCollapsed);
                            setDensityState(DEFAULT_SHELL_PREFERENCES.density);
                            setChatTextState(DEFAULT_SHELL_PREFERENCES.chatText);
                            setFontState(DEFAULT_SHELL_PREFERENCES.font);
                            setMotionState(DEFAULT_SHELL_PREFERENCES.motion);
                            try {
                              writeShellPreferences(window.localStorage, { ...DEFAULT_SHELL_PREFERENCES });
                            } catch {
                              // Layout prefs are optional.
                            }
                            window.dispatchEvent(new Event('boz_shell_updated'));
                            showToast('Layout reset');
                          }}
                          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Default ticker</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                        Symbol the workspace opens with when nothing is favorited or remembered yet.
                      </p>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', gap: '16px' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Default symbol</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>e.g. NVDA, BTC-USD, ^GSPC. Validated against the symbol directory.</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          <input
                            type="text"
                            value={defaultTicker}
                            placeholder="NVDA"
                            onChange={(e) => {
                              setDefaultTicker(e.target.value);
                              setTickerNote(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void saveDefaultTicker();
                              }
                            }}
                            style={{
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              color: 'var(--text-primary)',
                              padding: '8px 12px',
                              borderRadius: '6px',
                              fontSize: '13px',
                              outline: 'none',
                              width: '140px',
                              textTransform: 'uppercase',
                            }}
                          />
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              void saveDefaultTicker();
                            }}
                            style={{
                              background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none',
                              padding: '8px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                              cursor: saving ? 'wait' : 'pointer',
                            }}
                          >
                            Save
                          </button>
                        </div>
                      </div>
                      {tickerNote && (
                        <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '8px' }}>{tickerNote}</div>
                      )}
                    </div>

                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Data & privacy</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Local chart styles and stored workspace data.</p>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Reset chart styles</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Clear per-ticker chart customizations.</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            try {
                              window.localStorage.removeItem('boz_dashboard_chart_style');
                            } catch {
                              // Nothing stored, nothing to clear.
                            }
                            showToast('Chart styles reset');
                          }}
                          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                        >
                          Reset charts
                        </button>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Clear local data</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Remove stored chats, favorites, and screener configs from this browser.</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm('Clear local chats, favorites, and screener configs? This cannot be undone.')) return;
                            try {
                              window.localStorage.removeItem('boz_chat_sessions');
                              window.localStorage.removeItem('boz_favorites');
                              window.localStorage.removeItem('boz_screeners_config_v2');
                            } catch {
                              // Storage already unavailable; still notify listeners.
                            }
                            window.dispatchEvent(new Event('boz_chat_updated'));
                            window.dispatchEvent(new Event('boz_favorites_changed'));
                            showToast('Local data cleared');
                          }}
                          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--danger)', padding: '8px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                        >
                          Clear data
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
