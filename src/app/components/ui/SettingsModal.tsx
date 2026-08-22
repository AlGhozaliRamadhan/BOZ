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
  hasCustomKey: boolean;
  nvidiaKey: string;
  githubToken: string;
  customKey: string;
  customUrl: string;
  availableModels: { id: string; label: string }[];
}

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
    icon: <i className="fa-brands fa-github" style={{ fontSize: '24px' }}></i>,
    available: true,
    examples: ['gpt-4o', 'claude-3.5-sonnet', 'cohere-command-r', 'llama-3.1-70b']
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    description: 'High-performance inference with NVIDIA hardware acceleration',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8.948 8.798l-1.178.397c-.04-.397-.238-1.907-2.107-1.907-1.452 0-2.596 1.17-2.596 3.117 0 2.303 1.378 3.157 2.596 3.157 1.352 0 2.027-1.072 2.147-1.868l1.178.337c-.357 1.669-1.669 2.937-3.325 2.937-2.107 0-3.88-1.63-3.88-4.563 0-2.576 1.549-4.523 3.88-4.523 2.027 0 3.126 1.312 3.285 2.916zm2.419-2.718v8.682h-1.193V6.08h1.193zm3.959 0v8.682h-1.193V6.08h1.193zm4.843 2.918c-.853 0-1.669.517-1.909 1.372h3.621c-.04-.736-.557-1.372-1.712-1.372zm2.855 2.498h-4.783c.04 1.23.854 2.067 1.948 2.067.694 0 1.352-.318 1.709-.894l.972.576c-.636.994-1.669 1.512-2.82 1.512-1.988 0-3.285-1.432-3.285-3.525 0-2.027 1.233-3.564 3.225-3.564 1.986 0 3.105 1.471 3.105 3.326 0 .159-.01.319-.07.502z" />
      </svg>
    ),
    available: true,
    examples: ['meta/llama-3.1-405b', 'mistralai/mixtral-8x22b', 'nvidia/nemotron-4-340b']
  },
  {
    id: 'custom',
    name: '9router',
    description: 'OpenAI-compatible local router at localhost:20128/v1',
    icon: <i className="fa-solid fa-route" style={{ fontSize: '22px' }}></i>,
    available: true,
    examples: []
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Industry-leading models like GPT-4o and GPT-3.5',
    icon: <i className="fa-solid fa-bolt" style={{ fontSize: '24px' }}></i>,
    available: false,
    examples: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo']
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 3 Opus, Sonnet, and Haiku models',
    icon: <i className="fa-solid fa-brain" style={{ fontSize: '24px' }}></i>,
    available: false,
    examples: ['claude-3-opus', 'claude-3.5-sonnet', 'claude-3-haiku']
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Lightning fast LPU inference engine',
    icon: <i className="fa-solid fa-rocket" style={{ fontSize: '24px' }}></i>,
    available: false,
    examples: ['llama3-70b-8192', 'mixtral-8x7b-32768']
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified API across dozens of AI providers',
    icon: <i className="fa-solid fa-network-wired" style={{ fontSize: '24px' }}></i>,
    available: false,
    examples: ['google/gemini-pro', 'meta-llama/llama-3-70b', 'anthropic/claude-3']
  },
];

const ModelBadge = ({ modelName, isActiveProvider }: { modelName: string, isActiveProvider: boolean }) => {
  const [hovered, setHovered] = useState(false);
  const [status, setStatus] = useState<'idle'|'loading'|'success'|'error'>('idle');

  return (
    <div 
      onMouseEnter={() => setHovered(true)} 
      onMouseLeave={() => setHovered(false)}
      style={{ 
        display: 'flex', alignItems: 'center', gap: '6px',
        background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.1)', 
        color: 'var(--text-secondary)', padding: '4px 8px', borderRadius: '4px', 
        fontSize: '11px', fontWeight: 500, userSelect: 'none', transition: 'all 0.15s'
      }}
    >
      {status !== 'idle' && (
        <i className={`fa-solid ${status === 'loading' ? 'fa-circle-notch fa-spin' : status === 'success' ? 'fa-check' : 'fa-xmark'}`} 
           style={{ color: status === 'success' ? 'var(--bull)' : status === 'error' ? 'var(--bear)' : 'var(--text-muted)' }}>
        </i>
      )}
      
      <span>{modelName}</span>
      
      {hovered && (
        <div style={{ display: 'flex', gap: '6px', marginLeft: '4px', borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '6px' }}>
          <button 
            onClick={() => { navigator.clipboard.writeText(modelName); }}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            title="Copy Model Name"
          >
            <i className="fa-regular fa-copy"></i>
          </button>
          
          <button 
            onClick={async () => {
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
  const [customKey, setCustomKey] = useState('');
  const [customModels, setCustomModels] = useState<{ id: string; label: string }[]>([]);
  const [customModelDraft, setCustomModelDraft] = useState('');
  const [fetchingCustomModels, setFetchingCustomModels] = useState(false);

  // Local state for storing multiple keys per provider
  // Format: { providerId: [ { id: string, name: string, value: string, active: boolean } ] }
  const [providerKeys, setProviderKeys] = useState<Record<string, any[]>>({});

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to load settings');
      const data = await res.json();
      setConfig(data);
      setCustomUrl(data.customUrl || 'http://localhost:20128/v1');
      setCustomKey(data.customKey || '');
      setCustomModels(Array.isArray(data.availableModels) && data.provider === 'custom'
        ? data.availableModels
        : (data.allModels || []).filter((m: { provider?: string }) => m.provider === 'custom'));

      // Initialize local multi-key storage with the backend's active key
      const localKeys = localStorage.getItem('boz_provider_keys');
      let parsedKeys = localKeys ? JSON.parse(localKeys) : {
        nvidia: [],
        github: [],
        custom: []
      };

      // Ensure the backend key is synced as the active one
      if (data.hasNvidiaKey || data.nvidiaKey) {
        if (!parsedKeys.nvidia) parsedKeys.nvidia = [];
        if (parsedKeys.nvidia.length === 0) {
          parsedKeys.nvidia.push({ id: 'default', name: 'Default Key', value: data.nvidiaKey || '***', active: true });
        }
      }
      if (data.hasGithubToken || data.githubToken) {
        if (!parsedKeys.github) parsedKeys.github = [];
        if (parsedKeys.github.length === 0) {
          parsedKeys.github.push({ id: 'default', name: 'Default Key', value: data.githubToken || '***', active: true });
        }
      }
      
      setProviderKeys(parsedKeys);

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
    }
  }, [isOpen, fetchSettings]);

  // Reflect effort changes made elsewhere (TopBar Deep Think / effort pill).
  useEffect(() => {
    const sync = () => setEffortLocal(getEffort());
    window.addEventListener(CHAT_OPTIONS_EVENT, sync);
    return () => window.removeEventListener(CHAT_OPTIONS_EVENT, sync);
  }, []);

  const saveLocalKeys = (newKeys: any) => {
    setProviderKeys(newKeys);
    localStorage.setItem('boz_provider_keys', JSON.stringify(newKeys));
  };

  const addKey = (providerId: string) => {
    const newKeys = { ...providerKeys };
    if (!newKeys[providerId]) newKeys[providerId] = [];
    
    const isFirst = newKeys[providerId].length === 0;
    newKeys[providerId].push({
      id: Date.now().toString(),
      name: `Key ${newKeys[providerId].length + 1}`,
      value: '',
      active: isFirst
    });
    saveLocalKeys(newKeys);
  };

  const updateKey = (providerId: string, keyId: string, field: string, value: string) => {
    const newKeys = { ...providerKeys };
    const key = newKeys[providerId].find(k => k.id === keyId);
    if (key) {
      key[field] = value;
      saveLocalKeys(newKeys);
    }
  };

  const deleteKey = (providerId: string, keyId: string) => {
    const newKeys = { ...providerKeys };
    const wasActive = newKeys[providerId].find(k => k.id === keyId)?.active;
    newKeys[providerId] = newKeys[providerId].filter(k => k.id !== keyId);
    
    if (wasActive && newKeys[providerId].length > 0) {
      newKeys[providerId][0].active = true;
    }
    saveLocalKeys(newKeys);
  };

  const showToast = (msg: string) => {
    setSaveMessage(msg);
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const updateConfig = async (payload: any, successMsg: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update');
      const data = await res.json();
      setConfig(data);
      window.dispatchEvent(new Event('boz_settings_updated'));
      showToast(successMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const applyActiveKey = async (providerId: string, keyId: string) => {
    // 1. Update local state
    const newKeys = { ...providerKeys };
    newKeys[providerId].forEach(k => k.active = (k.id === keyId));
    saveLocalKeys(newKeys);

    // 2. Sync with backend
    const activeKey = newKeys[providerId].find(k => k.id === keyId);
    if (activeKey && activeKey.value && activeKey.value !== '***') {
      const payloadKey =
        providerId === 'nvidia' ? 'nvidiaKey' :
        providerId === 'custom' ? 'customKey' : 'githubToken';
      await updateConfig({ [payloadKey]: activeKey.value }, 'Active key applied to backend');
    }
  };

  const saveCustomEndpoint = async () => {
    const url = customUrl.trim() || 'http://localhost:20128/v1';
    await updateConfig({ customUrl: url, customKey }, '9router endpoint saved');
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
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '16px' }}>Select a provider to configure API keys and preferences.</p>
                      
                      {/* Search Bar */}
                      <div style={{ marginBottom: '16px', position: 'relative' }}>
                        <i className="fa-solid fa-search" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '12px' }}></i>
                        <input
                          type="text"
                          placeholder="Search providers (e.g. OpenAI, Anthropic, NVIDIA)..."
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
                          const keys = providerKeys[p.id] || [];
                          
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
                                    {!p.available && <span style={{ border: '1px solid var(--border-glass)', color: 'var(--text-muted)', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase' }}>Coming Soon</span>}
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
                                          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '8px' }}>API Key (optional)</label>
                                          <input
                                            type="password"
                                            value={customKey}
                                            onChange={(e) => setCustomKey(e.target.value)}
                                            onBlur={saveCustomEndpoint}
                                            placeholder="Leave blank if 9router does not require a key"
                                            style={{ width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '8px 10px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }}
                                          />
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

                                    {/* Multiple API Keys Manager */}
                                    {p.id !== 'custom' && (
                                    <div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>API Keys</label>
                                        <button 
                                          onClick={() => addKey(p.id)}
                                          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                                        >
                                          <i className="fa-solid fa-plus"></i> Add Key
                                        </button>
                                      </div>

                                      {keys.length === 0 ? (
                                        <div style={{ padding: '16px', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
                                          No API keys configured.
                                        </div>
                                      ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                          {keys.map((k) => (
                                            <div key={k.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '8px', border: k.active ? '1px solid var(--text-primary)' : '1px solid rgba(255,255,255,0.05)' }}>
                                              <input
                                                type="text"
                                                value={k.name}
                                                onChange={(e) => updateKey(p.id, k.id, 'name', e.target.value)}
                                                placeholder="Key Name"
                                                style={{ width: '100px', background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '12px', outline: 'none' }}
                                              />
                                              <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.1)' }}></div>
                                              <input
                                                type="password"
                                                value={k.value}
                                                onChange={(e) => updateKey(p.id, k.id, 'value', e.target.value)}
                                                placeholder="sk-..."
                                                style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '12px', outline: 'none', fontFamily: 'monospace' }}
                                              />
                                              {k.active ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                  <button onClick={() => applyActiveKey(p.id, k.id)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }} title="Save any changes to this key">Save</button>
                                                </div>
                                              ) : (
                                                <button onClick={() => applyActiveKey(p.id, k.id)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer' }}>Save & Use</button>
                                              )}
                                              <button onClick={() => deleteKey(p.id, k.id)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px' }} title="Delete Key">
                                                <i className="fa-solid fa-trash-can"></i>
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    )}

                                    {/* Supported Models Badges */}
                                    {p.id !== 'custom' && p.examples && (
                                      <div style={{ marginTop: '8px' }}>
                                        <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, margin: '0 0 8px 0', display: 'block', textTransform: 'uppercase' }}>Available Models</label>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                          {p.examples.map(ex => (
                                            <ModelBadge key={ex} modelName={ex} isActiveProvider={isActiveProvider} />
                                          ))}
                                          <button 
                                            onClick={() => {
                                              const newModel = prompt('Enter custom model name (e.g. custom-llama-3):');
                                              if (newModel && newModel.trim()) {
                                                const updatedProviders = [...ALL_PROVIDERS];
                                                const providerIndex = updatedProviders.findIndex(prov => prov.id === p.id);
                                                if (providerIndex !== -1 && updatedProviders[providerIndex].examples) {
                                                  if (!updatedProviders[providerIndex].examples.includes(newModel.trim())) {
                                                    updatedProviders[providerIndex].examples.push(newModel.trim());
                                                  }
                                                }
                                              }
                                            }}
                                            style={{ background: 'transparent', border: '1px dashed rgba(255,255,255,0.2)', color: 'var(--text-muted)', padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s ease' }}
                                            onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                                            onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                                          >
                                            <i className="fa-solid fa-plus" style={{ marginRight: '4px' }}></i> Add Model
                                          </button>
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
                                        onClick={async () => {
                                          setTestLoading(true);
                                          setTestResult(null);
                                          try {
                                            const res = await fetch('/api/settings/test', { method: 'POST' });
                                            const data = await res.json();
                                            if (data.success) {
                                              setTestResult({ success: true, message: 'Keys configured correctly' });
                                            } else {
                                              setTestResult({ success: false, message: data.message });
                                            }
                                          } catch {
                                            setTestResult({ success: false, message: 'Failed to verify key' });
                                          } finally {
                                            setTestLoading(false);
                                          }
                                        }}
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
                          <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>Thinking Effort</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            Depth of chain-of-thought reasoning. Higher = more tokens, slower, more thorough.
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
                          <option value="Low">Low (1-2 sentences)</option>
                          <option value="Medium">Medium (step-by-step)</option>
                          <option value="High">High (rigorous)</option>
                          <option value="Extra">Extra (multi-perspective)</option>
                          <option value="Max">Max (exhaustive 6-step)</option>
                        </select>
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
