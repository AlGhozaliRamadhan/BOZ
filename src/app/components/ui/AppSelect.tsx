'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import styles from './AppSelect.module.css';

export interface AppSelectOption {
  value: string;
  label: string;
  /** Optional second line shown in the menu only (e.g. what a screen does). */
  description?: string;
}

interface AppSelectProps {
  value: string;
  options: ReadonlyArray<AppSelectOption>;
  onChange: (value: string) => void;
  /** Accessible name when no visible label points at the trigger. */
  ariaLabel?: string;
  /** Id of the visible label element, when there is one. */
  labelledBy?: string;
  id?: string;
  disabled?: boolean;
  /** Open the menu left-aligned (default) or right-aligned to the trigger. */
  align?: 'start' | 'end';
  /** Narrow trigger for toolbars. */
  compact?: boolean;
  className?: string;
}

/**
 * The app's dropdown: a glass trigger plus a rendered listbox.
 *
 * A native <select> opens an OS popup that ignores the dark theme, which is
 * how white text ends up on a white option list. This renders the options on
 * the app surface instead: the trigger keeps focus, ArrowUp / ArrowDown walk
 * the list, Enter or Space commits, Escape and outside clicks dismiss.
 * Hovering moves the highlight.
 */
export default function AppSelect({
  value,
  options,
  onChange,
  ariaLabel,
  labelledBy,
  id,
  disabled = false,
  align = 'start',
  compact = false,
  className,
}: AppSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const listId = `${generatedId}-listbox`;
  const optionId = (index: number) => `${generatedId}-option-${index}`;

  const selectedIndex = options.findIndex(option => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // The highlight starts on the committed value each time the list opens.
  useEffect(() => {
    if (open) setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  // Keep the highlighted row in view for long lists.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const close = () => setOpen(false);

  const commit = (next: string) => {
    setOpen(false);
    triggerRef.current?.focus();
    if (next !== value) onChange(next);
  };

  const step = (delta: number) => {
    setActiveIndex(current => Math.max(0, Math.min(options.length - 1, current + delta)));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        close();
      }
      return;
    }

    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        step(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        step(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const option = options[activeIndex];
        if (option) commit(option.value);
        break;
      }
      case 'Tab':
        close();
        break;
      default:
        break;
    }
  };

  return (
    <div className={`${styles.root}${className ? ` ${className}` : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        className={`${styles.trigger}${compact ? ` ${styles.triggerCompact}` : ''}${open ? ` ${styles.triggerOpen}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        disabled={disabled}
        onClick={() => setOpen(current => !current)}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.value}>{selected?.label ?? 'Select…'}</span>
        <i className={`fa-solid fa-chevron-down ${styles.chevron}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          aria-labelledby={labelledBy}
          className={`${styles.menu}${align === 'end' ? ` ${styles.menuEnd}` : ''}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <button
                key={option.value}
                id={optionId(index)}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-index={index}
                tabIndex={-1}
                className={`${styles.option}${isActive ? ` ${styles.optionActive}` : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(option.value)}
              >
                <span className={styles.optionText}>
                  <span className={`${styles.optionLabel}${isSelected ? ` ${styles.optionLabelSelected}` : ''}`}>
                    {option.label}
                  </span>
                  {option.description && (
                    <span className={styles.optionDescription}>{option.description}</span>
                  )}
                </span>
                {isSelected && <i className={`fa-solid fa-check ${styles.check}`} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
