'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  type Effort,
  getEffort,
  setEffort,
  CHAT_OPTIONS_EVENT,
} from '../../../shared/chat-options';

interface SettingsConfig {
  provider: string;
  model: string;
  endpoint: string;
  ticker: string;
  riskMode: string;
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

const ALL_PROVIDERS = [
  {
    id: 'github',
    name: 'GitHub Models',
    description: 'GitHub-hosted AI models with free tier access',
    icon: <i className="fa-brands fa-github" style={{ fontSize: '24px' }} aria-hidden="true"></i>,
    available: true,
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    description: 'High-performance inference with NVIDIA hardware acceleration',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-label="NVIDIA">
        <path d="M8.948 8.798l-1.178.397c-.04-.397-.238-1.907-2.107-1.907-1.452 0-2.596 1.17-2.596 3.117 0 2.303 1.378 3.157 2.596 3.157 1.352 0 2.027-1.072 2.147-1.868l1.178.337c-.357 1.669-1.669 2.937-3.325 2.937-2.107 0-3.88-1.63-3.88-4.563 0-2.576 1.549-4.523 3.88-4.523 2.027 0 3.126 1.312 3.285 2.916zm2.419-2.718v8.682h-1.193V6.08h1.193zm3.959 0v8.682h-1.193V6.08h1.193zm4.843 2.918c-.853 0-1.669.517-1.909 1.372h3.621c-.04-.736-.557-1.372-1.712-1.372zm2.855 2.498h-4.783c.04 1.23.854 2.067 1.948 2.067.694 0 1.352-.318 1.709-.894l.972.576c-.636.994-1.669 1.512-2.82 1.512-1.988 0-3.285-1.432-3.285-3.525 0-2.027 1.233-3.564 3.225-3.564 1.986 0 3.105 1.471 3.105 3.326 0 .159-.01.319-.07.502z" />
      </svg>
    ),
    available: true,
  },
  {
    id: 'custom',
    name: '9router',
    description: 'Your OpenAI-compatible local router or gateway',
    icon: <span aria-label="9router" style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-1px' }}>9R</span>,
    available: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT models through the official OpenAI API',
    icon: <span aria-label="OpenAI" style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-1px' }}>AI</span>,
    available: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models through the official Messages API',
    icon: <span aria-label="Anthropic" style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-1px' }}>A</span>,
    available: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Fast OpenAI-compatible inference from GroqCloud',
    icon: <span aria-label="Groq" style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-1px' }}>G</span>,
    available: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'One OpenAI-compatible API for hundreds of models',
    icon: <span aria-label="OpenRouter" style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '-1px' }}>OR</span>,
    available: true,
  },
  {
    id: 'offline',
    name: 'Ollama',
    description: 'Private, Ollama-compatible inference running on your machine',
    icon: <i className="fa-solid fa-server" style={{ fontSize: '20px' }} aria-hidden="true"></i>,
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

export default function SettingsModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'providers' | 'general'>('providers');
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [config, setConfig] = useState<SettingsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [effort, setEffortLocal] = useState<Effort>(() => getEffort());
  const [customUrl, setCustomUrl] = useState('http://localhost:20128/v1');
  const [offlineUrl, setOfflineUrl] = useState('http://localhost:11434');
  const [customKey, setCustomKey] = useState('');
  const [customModels, setCustomModels] = useState<{ id: string; label: string }[]>([]);
  const [customModelDraft, setCustomModelDraft] = useState('');
  const [fetchingCustomModels, setFetchingCustomModels] = useState(false);
  const [credentialDrafts, setCredentialDrafts] = useState<Record<CredentialProviderId, string>>({
    github: '',
    nvidia: '',
    custom: '',
    openai: '',
    anthropic: '',
    groq: '',
    openrouter: '',
  });
  const [updateInfo, setUpdateInfo] = useState<{
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    packageUrl: string;
    updateCommand: string;
  } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [copiedUpdateCommand, setCopiedUpdateCommand] = useState(false);

  const fetchUpdateInfo = useCallback(async (force = false) => {
    setCheckingUpdate(true);
    try {
      const res = await fetch(`/api/version${force ? '?force=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        setUpdateInfo(data);
      }
    } catch {
      // Ignore background error
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to load settings');
      const data = await res.json();
      setConfig(data);
      setCustomUrl(data.customUrl || 'http://localhost:20128/v1');
      setOfflineUrl(data.offlineUrl || 'http://localhost:11434');
      setCustomKey('');
      setCustomModels(Array.isArray(data.availableModels) && data.provider === 'custom'
        ? data.availableModels
        : (data.allModels || []).filter((m: { provider?: string }) => m.provider === 'custom'));
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
      fetchUpdateInfo(false);
      setSearchQuery('');
    }
  }, [isOpen, fetchSettings, fetchUpdateInfo]);

  useEffect(() => {
    // Remove credentials persisted by releases before the write-only settings API.
    localStorage.removeItem('boz_provider_keys');
  }, []);

  // Reflect effort changes made elsewhere (TopBar Deep Think / effort pill).
  useEffect(() => {
    const sync = () => setEffortLocal(getEffort());
    window.addEventListener(CHAT_OPTIONS_EVENT, sync);
    return () => window.removeEventListener(CHAT_OPTIONS_EVENT, sync);
  }, []);

  const showToast = (msg: string) => {
    setSaveMessage(msg);
    setTimeout(() => setSaveMessage(null), 3000);
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
        background: 'var(--bg-elevated)', width: '100%', maxWidth: '900px', height: '70vh', minHeight: '550px',
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

                {activeTab === 'general' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Application settings</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>General configuration options.</p>
                      
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Default Ticker</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>The stock loaded initially.</div>
                        </div>
                        <input
                          type="text"
                          defaultValue={config?.ticker || 'NVDA'}
                          onBlur={(e) => {
                            if (e.target.value && e.target.value !== config?.ticker) {
                              updateConfig({ ticker: e.target.value }, 'Ticker updated');
                            }
                          }}
                          style={{ width: '80px', background: 'rgba(255, 255, 255, 0.05)', border: 'none', color: 'var(--text-primary)', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', textAlign: 'center', outline: 'none' }}
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Analysis Effort</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Depth of private verification. Higher is slower and more thorough; answers stay concise by default.
                          </div>
                        </div>
                        <select
                          value={effort}
                          onChange={(e) => setEffort(e.target.value as Effort)}
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: 'var(--text-primary)',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            outline: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <option value="Low">Low (quick check)</option>
                          <option value="Medium">Medium (balanced)</option>
                          <option value="High">High (rigorous)</option>
                          <option value="Extra">Extra (cross-checked)</option>
                          <option value="Max">Max (deep verification)</option>
                        </select>
                      </div>
                    </div>

                    {/* Version & Updates Section */}
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px', color: 'var(--text-primary)' }}>Version & Updates</h3>
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Manage BOZ application updates and npm package releases.</p>

                      <div style={{
                        padding: '16px',
                        borderRadius: '10px',
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '16px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
                              BOZ v{updateInfo?.currentVersion || '2.5.6'}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {checkingUpdate ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <i className="fa-solid fa-spinner fa-spin"></i> Checking npm registry...
                                </span>
                              ) : updateInfo?.updateAvailable ? (
                                <span style={{ color: 'var(--accent-cyan)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <i className="fa-solid fa-arrow-up"></i> Update available: v{updateInfo.latestVersion}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--bull, #00d2ff)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <i className="fa-solid fa-check"></i> Running the latest version
                                </span>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => fetchUpdateInfo(true)}
                            disabled={checkingUpdate}
                            style={{
                              background: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              color: 'var(--text-primary)',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 500,
                              cursor: checkingUpdate ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <i className={`fa-solid fa-rotate-right ${checkingUpdate ? 'fa-spin' : ''}`}></i>
                            <span>Check for Updates</span>
                          </button>
                        </div>

                        {updateInfo?.updateAvailable && (
                          <div style={{
                            padding: '12px 14px',
                            background: 'rgba(0, 210, 255, 0.06)',
                            border: '1px solid rgba(0, 210, 255, 0.2)',
                            borderRadius: '8px',
                          }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                              Install Update via Terminal:
                            </div>
                            <div style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '10px',
                              background: 'rgba(0, 0, 0, 0.4)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              borderRadius: '6px',
                              padding: '8px 12px',
                              fontFamily: 'var(--font-mono, monospace)',
                              fontSize: '12px',
                              color: 'var(--accent-cyan)',
                            }}>
                              <code>{updateInfo.updateCommand}</code>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(updateInfo.updateCommand);
                                  setCopiedUpdateCommand(true);
                                  setTimeout(() => setCopiedUpdateCommand(false), 2500);
                                }}
                                style={{
                                  background: copiedUpdateCommand ? 'rgba(0, 210, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                                  border: '1px solid rgba(255, 255, 255, 0.15)',
                                  color: copiedUpdateCommand ? 'var(--accent-cyan)' : 'var(--text-primary)',
                                  borderRadius: '4px',
                                  padding: '4px 8px',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <i className={`fa-solid ${copiedUpdateCommand ? 'fa-check' : 'fa-copy'}`}></i>
                                <span>{copiedUpdateCommand ? 'Copied' : 'Copy'}</span>
                              </button>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                              <a
                                href={updateInfo.packageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  color: 'var(--text-muted)',
                                  fontSize: '11px',
                                  textDecoration: 'underline',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                <i className="fa-brands fa-npm"></i> View @agr77/boz on npm
                              </a>
                            </div>
                          </div>
                        )}
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
