'use client';

import { useState, useEffect, useCallback } from 'react';

interface SettingsConfig {
  provider: string;
  model: string;
  endpoint: string;
  ticker: string;
  riskMode: string;
  hasGithubToken: boolean;
  hasNvidiaKey: boolean;
  nvidiaKey: string;
  githubToken: string;
  availableModels: { id: string; label: string }[];
}

interface ConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

const PROVIDERS = [
  {
    id: 'github',
    name: 'GitHub Models',
    description: 'GitHub-hosted AI models with free tier access',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
      </svg>
    ),
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    description: 'High-performance inference with NVIDIA hardware acceleration',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8.948 8.798l-1.178.397c-.04-.397-.238-1.907-2.107-1.907-1.452 0-2.596 1.17-2.596 3.117 0 2.303 1.378 3.157 2.596 3.157 1.352 0 2.027-1.072 2.147-1.868l1.178.337c-.357 1.669-1.669 2.937-3.325 2.937-2.107 0-3.88-1.63-3.88-4.563 0-2.576 1.549-4.523 3.88-4.523 2.027 0 3.126 1.312 3.285 2.916zm2.419-2.718v8.682h-1.193V6.08h1.193zm3.959 0v8.682h-1.193V6.08h1.193zm4.843 2.918c-.853 0-1.669.517-1.909 1.372h3.621c-.04-.736-.557-1.372-1.712-1.372zm2.855 2.498h-4.783c.04 1.23.854 2.067 1.948 2.067.694 0 1.352-.318 1.709-.894l.972.576c-.636.994-1.669 1.512-2.82 1.512-1.988 0-3.285-1.432-3.285-3.525 0-2.027 1.233-3.564 3.225-3.564 1.986 0 3.105 1.471 3.105 3.326 0 .159-.01.319-.07.502z" />
      </svg>
    ),
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Run AI models locally with complete data privacy',
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <circle cx="9" cy="9" r="1.5" fill="currentColor" />
        <circle cx="15" cy="9" r="1.5" fill="currentColor" />
        <path d="M9 15c.83 1.17 2.17 2 3 2s2.17-.83 3-2" />
      </svg>
    ),
  },
];

export default function SettingsPage() {
  const [config, setConfig] = useState<SettingsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ConnectionResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [defaultTicker, setDefaultTicker] = useState('');
  const [riskMode, setRiskMode] = useState('auto');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  
  // Local state for API keys to allow explicit saving
  const [nvidiaKeyInput, setNvidiaKeyInput] = useState('');
  const [githubTokenInput, setGithubTokenInput] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error('Failed to load settings');
      const data = await res.json();
      setConfig(data);
      setDefaultTicker(data.ticker || 'NVDA');
      setRiskMode(data.riskMode || 'auto');
      setNvidiaKeyInput(data.nvidiaKey || '');
      setGithubTokenInput(data.githubToken || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const selectProvider = async (providerId: string) => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      if (!res.ok) throw new Error('Failed to update provider');
      const data = await res.json();
      setConfig(data);
      setSaveMessage('Provider updated successfully');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const selectModel = async (modelId: string) => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      });
      if (!res.ok) throw new Error('Failed to update model');
      const data = await res.json();
      setConfig(data);
      setSaveMessage('Model updated successfully');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const saveApiKey = async (keyType: 'nvidiaKey' | 'githubToken', value: string) => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [keyType]: value }),
      });
      if (!res.ok) throw new Error('Failed to update API key');
      const data = await res.json();
      setConfig(data);
      setSaveMessage('API key updated successfully');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // Preferences were removed

  const testConnection = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/settings/test', {
        method: 'POST',
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, message: 'Connection test failed' });
    } finally {
      setTestLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-fadeIn">
        <div className="page-header">
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure AI providers and preferences</p>
        </div>
        <div className="flex-col gap-6">
          <div className="skeleton skeleton-card"></div>
          <div className="skeleton skeleton-card"></div>
          <div className="skeleton skeleton-card"></div>
        </div>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="animate-fadeIn">
        <div className="page-header">
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure AI providers and preferences</p>
        </div>
        <div className="glass-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="empty-state-title">Failed to Load Settings</h3>
            <p className="empty-state-text">{error}</p>
            <button className="btn btn-primary" onClick={fetchSettings}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configure AI providers and preferences</p>
      </div>

      {/* Save notification */}
      {saveMessage && (
        <div className="toast-container">
          <div className="toast success">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {saveMessage}
          </div>
        </div>
      )}

      <div className="flex-col gap-6">
        
        {/* Active AI Configuration */}
        <div style={{ paddingTop: 'var(--space-2)' }}>
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, borderBottom: '1px solid var(--border-glass)', paddingBottom: 'var(--space-2)', display: 'block', width: '100%', color: 'var(--text-primary)' }}>
              Active AI Configuration
            </span>
          </div>

          <div className="grid-2 gap-8" style={{ marginBottom: 'var(--space-8)' }}>
            {/* Provider Selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>AI Provider</span>
              <p className="page-subtitle" style={{ margin: 0, minHeight: '40px' }}>Select the platform that will power the AI analysis.</p>
              <select 
                className="input" 
                value={config?.provider || ''} 
                onChange={(e) => selectProvider(e.target.value)}
                disabled={saving}
                style={{ background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', marginTop: 'auto' }}
              >
                {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            {/* Model Selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>AI Model</span>
              <p className="page-subtitle" style={{ margin: 0, minHeight: '40px' }}>Choose the specific model to use for inference.</p>
              
              {config?.provider === 'offline' ? (
                <div className="input-group" style={{ marginTop: 'auto' }}>
                  <input
                    type="text"
                    id="offline-model-input"
                    className="input"
                    placeholder="e.g. llama3"
                    defaultValue={config?.model || ''}
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== config?.model) {
                        selectModel(e.target.value);
                      }
                    }}
                    disabled={saving}
                    style={{ background: 'transparent', border: '1px solid var(--border-glass)' }}
                  />
                  <button 
                    className="btn btn-primary" 
                    onClick={() => {
                      const input = document.getElementById('offline-model-input') as HTMLInputElement;
                      if (input && input.value && input.value !== config?.model) {
                        selectModel(input.value);
                      }
                    }}
                    disabled={saving}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <select 
                  className="input" 
                  value={config?.model || ''} 
                  onChange={(e) => selectModel(e.target.value)}
                  disabled={saving}
                  style={{ background: 'var(--bg-glass)', border: '1px solid var(--border-glass)', marginTop: 'auto' }}
                >
                  {config?.availableModels?.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>

        {/* Unified Integration Panel - Flat Layout */}
        <div style={{ paddingTop: 'var(--space-2)' }}>
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <span style={{ fontSize: 'var(--text-base)', fontWeight: 600, borderBottom: '1px solid var(--border-glass)', paddingBottom: 'var(--space-2)', display: 'block', width: '100%', color: 'var(--text-primary)' }}>
              API Connections
            </span>
          </div>

          <div className="grid-2 gap-8" style={{ marginBottom: 'var(--space-8)' }}>
            {/* NVIDIA Integration */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="flex-row items-center justify-between">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(118, 185, 0, 0.1)', color: '#76B900', borderRadius: '50%' }}>
                    {PROVIDERS[1].icon}
                  </div>
                  <span style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 600 }}>NVIDIA NIM</span>
                </div>
                {config?.hasNvidiaKey ? (
                  <div style={{ color: 'var(--bull)', display: 'flex', alignItems: 'center' }} title="Configured">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                ) : (
                  <div style={{ color: 'var(--bear)', display: 'flex', alignItems: 'center' }} title="Missing">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  </div>
                )}
              </div>
              <p className="page-subtitle" style={{ margin: 0, minHeight: '40px' }}>Required for NVIDIA hardware-accelerated AI models.</p>
              <div className="input-group" style={{ marginTop: 'auto' }}>
                <input
                  type="password"
                  className="input"
                  placeholder={config?.hasNvidiaKey ? "Key is set (enter new key to replace)" : "nvapi-..."}
                  value={nvidiaKeyInput}
                  onChange={(e) => setNvidiaKeyInput(e.target.value)}
                  disabled={saving}
                  style={{ background: 'transparent', border: '1px solid var(--border-glass)' }}
                />
                <button 
                  className="btn btn-primary" 
                  onClick={() => saveApiKey('nvidiaKey', nvidiaKeyInput)}
                  disabled={saving || (!nvidiaKeyInput && !config?.hasNvidiaKey)}
                >
                  Save
                </button>
              </div>
            </div>

            {/* GitHub Integration */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className="flex-row items-center justify-between">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '50%' }}>
                    {PROVIDERS[0].icon}
                  </div>
                  <span style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 600 }}>GitHub Models</span>
                </div>
                {config?.hasGithubToken ? (
                  <div style={{ color: 'var(--bull)', display: 'flex', alignItems: 'center' }} title="Configured">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                ) : (
                  <div style={{ color: 'var(--bear)', display: 'flex', alignItems: 'center' }} title="Missing">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  </div>
                )}
              </div>
              <p className="page-subtitle" style={{ margin: 0, minHeight: '40px' }}>Required for GitHub free-tier AI models.</p>
              <div className="input-group" style={{ marginTop: 'auto' }}>
                <input
                  type="password"
                  className="input"
                  placeholder={config?.hasGithubToken ? "Token is set (enter new token to replace)" : "ghp_..."}
                  value={githubTokenInput}
                  onChange={(e) => setGithubTokenInput(e.target.value)}
                  disabled={saving}
                  style={{ background: 'transparent', border: '1px solid var(--border-glass)' }}
                />
                <button 
                  className="btn btn-primary" 
                  onClick={() => saveApiKey('githubToken', githubTokenInput)}
                  disabled={saving || (!githubTokenInput && !config?.hasGithubToken)}
                >
                  Save
                </button>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <button
              className="btn btn-secondary"
              onClick={testConnection}
              disabled={testLoading}
              style={{ background: 'transparent', border: '1px solid var(--border-glass)', fontSize: 'var(--text-sm)' }}
            >
              {testLoading ? (
                <>
                  <span className="spinner spinner-sm"></span>
                  Testing
                </>
              ) : (
                'Test Connection'
              )}
            </button>

            {testResult && (
              <div className="flex-row items-center animate-fadeIn" style={{ fontSize: 'var(--text-sm)' }}>
                <span style={{ color: testResult.success ? 'var(--bull)' : 'var(--bear)', fontWeight: 500, marginRight: 'var(--space-2)' }}>
                  {testResult.success ? '✓ Verified' : '✕ Failed'}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{testResult.message}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
