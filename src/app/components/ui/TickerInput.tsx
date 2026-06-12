'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { SYMBOL_MAP } from '../../../shared/market-constants';

interface TickerInputProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit?: () => void;
}

const allSymbols = Object.keys(SYMBOL_MAP);

export default function TickerInput({ value, onChange, onSubmit }: TickerInputProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    if (!value.trim()) return [];
    const upper = value.toUpperCase();
    return allSymbols.filter((s) => s.startsWith(upper)).slice(0, 8);
  }, [value]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value.toUpperCase());
      setShowDropdown(true);
      setHighlightIndex(-1);
    },
    [onChange],
  );

  const selectSuggestion = useCallback(
    (symbol: string) => {
      onChange(symbol);
      setShowDropdown(false);
      setHighlightIndex(-1);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIndex >= 0 && suggestions[highlightIndex]) {
          selectSuggestion(suggestions[highlightIndex]);
        }
        onSubmit?.();
      } else if (e.key === 'Escape') {
        setShowDropdown(false);
      }
    },
    [suggestions, highlightIndex, selectSuggestion, onSubmit],
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="ticker-input-wrapper">
      <div className="input-group">
        <input
          type="text"
          className="input"
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => value.trim() && setShowDropdown(true)}
          placeholder="Enter ticker symbol (e.g. AAPL, BTC)"
          aria-label="Ticker symbol"
          autoComplete="off"
        />
      </div>
      {showDropdown && suggestions.length > 0 && (
        <div className="glass-card compact" role="listbox">
          {suggestions.map((symbol, idx) => (
            <div
              key={symbol}
              role="option"
              aria-selected={idx === highlightIndex}
              className={`sidebar-link${idx === highlightIndex ? ' active' : ''}`}
              onMouseDown={() => selectSuggestion(symbol)}
              onMouseEnter={() => setHighlightIndex(idx)}
            >
              <span className="sidebar-link-icon">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
                  <text x="7" y="10" textAnchor="middle" fill="currentColor" fontSize="7" fontWeight="600">$</text>
                </svg>
              </span>
              <span className="sidebar-link-label">
                {symbol} → {SYMBOL_MAP[symbol]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
