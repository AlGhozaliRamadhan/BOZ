'use client';

import { useMemo, useState } from 'react';
import { filterModelOptions, type ModelOption } from './model-picker';

interface ModelPickerProps {
  models: ModelOption[];
  activeId?: string;
  onSelect: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  disabled?: boolean;
  emptyHint?: string;
}

/**
 * Compact, searchable model list.
 *
 * The previous UI rendered every model as a wrapping badge. With a connected
 * 9router that is hundreds of chips, which pushed the rest of Settings off
 * screen and made the active model impossible to find. A fixed-height list with
 * a filter keeps the panel the same size no matter how large the catalog is.
 */
export default function ModelPicker({
  models,
  activeId,
  onSelect,
  onRefresh,
  refreshing = false,
  disabled = false,
  emptyHint = 'No models yet. Fetch the router list or add one below.',
}: ModelPickerProps) {
  const [query, setQuery] = useState('');
  const view = useMemo(
    () => filterModelOptions(models, query, activeId),
    [models, query, activeId],
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>
          Models
          <span style={{ color: 'var(--text-muted)', fontWeight: 500, marginLeft: '6px' }}>
            {models.length > 0 ? `${models.length} available` : ''}
          </span>
        </label>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing || disabled}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'var(--text-primary)',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '11px',
              cursor: refreshing ? 'progress' : 'pointer',
            }}
          >
            {refreshing ? 'Loading...' : 'Fetch /v1/models'}
          </button>
        )}
      </div>

      {models.length > 8 && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search models"
          spellCheck={false}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text-primary)',
            padding: '7px 10px',
            borderRadius: '6px',
            fontSize: '12px',
            outline: 'none',
            marginBottom: '8px',
          }}
        />
      )}

      <div
        role="listbox"
        aria-label="Custom provider models"
        style={{
          maxHeight: '220px',
          overflowY: 'auto',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        {models.length === 0 ? (
          <p style={{ margin: 0, padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
            {emptyHint}
          </p>
        ) : view.models.length === 0 ? (
          <p style={{ margin: 0, padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
            No models match “{query.trim()}”.
          </p>
        ) : (
          view.models.map((model) => {
            const active = model.id === activeId;
            return (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={active}
                disabled={disabled}
                onClick={() => onSelect(model.id)}
                title={model.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  width: '100%',
                  padding: '8px 12px',
                  border: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                  cursor: disabled ? 'default' : 'pointer',
                  textAlign: 'left',
                  font: 'inherit',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: active ? 600 : 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {model.label}
                  </span>
                  {model.label !== model.id && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        fontFamily: 'monospace',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {model.id}
                    </span>
                  )}
                </span>
                {active && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ flexShrink: 0 }}
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })
        )}
      </div>

      {view.truncated && (
        <p style={{ margin: '6px 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
          Showing {view.models.length} of {view.total}. Type to narrow the list.
        </p>
      )}
    </div>
  );
}
