'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getShellNavigationTarget } from './shell-menu';
import { searchShellCommands, type SettingsTab, type ShellCommand } from './shell-commands';

interface AppMenuBarProps {
  onToggleSidebar: () => void;
}

function dispatchShellEvent(name: string, detail?: { tab?: SettingsTab }): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export default function AppMenuBar({
  onToggleSidebar,
}: AppMenuBarProps) {
  const router = useRouter();
  const searchRootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDesktopWindow, setIsDesktopWindow] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        if (cancelled) return;
        const appWindow = getCurrentWindow();
        setIsDesktopWindow(true);
        try {
          setIsMaximized(await appWindow.isMaximized());
        } catch {
          // Maximized state is cosmetic; the toggle still works.
        }
        try {
          unlisten = await appWindow.onResized(async () => {
            try {
              setIsMaximized(await appWindow.isMaximized());
            } catch {
              // Ignore transient state read failures.
            }
          });
        } catch {
          // Resize listener is optional.
        }
      } catch {
        // Browser / web build: keep the native OS window chrome.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const openSearch = () => {
    setSearchOpen(true);
    searchInputRef.current?.focus();
  };

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!searchRootRef.current?.contains(event.target as Node)) {
        setSearchOpen(false);
        setActiveIndex(0);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setActiveIndex(0);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        onToggleSidebar();
        setSearchOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        router.push(getShellNavigationTarget('newChat'));
        dispatchShellEvent('boz_new_chat');
        setSearchOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === ',') {
        event.preventDefault();
        dispatchShellEvent('boz_open_settings');
        setSearchOpen(false);
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onToggleSidebar, router]);

  const results = searchShellCommands(query);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, searchOpen]);

  const runCommand = (command: ShellCommand) => {
    if (command.kind === 'route' && command.href) {
      router.push(command.href);
    } else {
      switch (command.action) {
        case 'new-chat':
          router.push(getShellNavigationTarget('newChat'));
          dispatchShellEvent('boz_new_chat');
          break;
        case 'open-settings':
          dispatchShellEvent('boz_open_settings', command.settingsTab ? { tab: command.settingsTab } : undefined);
          break;
        case 'open-about':
          dispatchShellEvent('boz_open_about');
          break;
        default:
          break;
      }
    }
    setSearchOpen(false);
    setQuery('');
    setActiveIndex(0);
    searchInputRef.current?.blur();
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault();
      setSearchOpen(true);
      setActiveIndex(current => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault();
      setSearchOpen(true);
      setActiveIndex(current => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      const selected = results[activeIndex];
      if (searchOpen && selected) {
        event.preventDefault();
        runCommand(selected);
      }
    }
  };

  const runWindowCommand = async (command: 'minimize' | 'toggleMaximize' | 'close') => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      if (command === 'minimize') await appWindow.minimize();
      else if (command === 'toggleMaximize') await appWindow.toggleMaximize();
      else await appWindow.close();
    } catch {
      // Browser / web build: no custom window chrome to control.
    }
  };

  const handleTitleBarDoubleClick = (event: React.MouseEvent) => {
    if (!isDesktopWindow) return;
    if ((event.target as HTMLElement).closest('button, a, input, [role="listbox"], [role="option"]')) return;
    void runWindowCommand('toggleMaximize');
  };

  const handleTitleBarMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, a, input, [role="listbox"], [role="option"]')) return;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().startDragging();
      } catch {
        // Native drag region already handles the gesture.
      }
    })();
  };

  return (
    <header className="app-menu-bar" data-tauri-drag-region onMouseDown={handleTitleBarMouseDown} onDoubleClick={handleTitleBarDoubleClick}>
      <div className="app-menu-bar-left" data-tauri-drag-region>
        <Link href="/" className="app-menu-brand" aria-label="BOZ home">
          <img src="/logo-boz-transparant-white.png" alt="" aria-hidden="true" />
        </Link>
      </div>

      <div className="app-menu-bar-center" ref={searchRootRef}>
        <div className="app-menu-nav" role="group" aria-label="Page navigation">
          <button
            type="button"
            className="app-menu-icon-button"
            onClick={() => router.back()}
            title="Back"
            aria-label="Go back"
          >
            <i className="fa-solid fa-arrow-left" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="app-menu-icon-button"
            onClick={() => router.forward()}
            title="Forward"
            aria-label="Go forward"
          >
            <i className="fa-solid fa-arrow-right" aria-hidden="true" />
          </button>
        </div>
        <div className="app-menu-search">
          <i className="fa-solid fa-magnifying-glass app-menu-search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            id="app-menu-search"
            type="text"
            role="combobox"
            aria-expanded={searchOpen}
            aria-controls="app-menu-search-list"
            aria-activedescendant={searchOpen && results[activeIndex] ? `app-menu-search-option-${results[activeIndex].id}` : undefined}
            aria-label="Search"
            className="app-menu-search-input"
            placeholder="Search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={handleSearchKeyDown}
          />
          {query && (
            <button
              type="button"
              className="app-menu-search-clear"
              onClick={() => {
                setQuery('');
                openSearch();
              }}
              title="Clear search"
              aria-label="Clear search"
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          )}
          {searchOpen && (
            <div className="app-menu-dropdown app-menu-search-results" role="listbox" id="app-menu-search-list" aria-label="Matching destinations">
              {results.length === 0 ? (
                <div className="app-menu-search-empty">No matches</div>
              ) : (
                results.map((command, index) => (
                  <button
                    type="button"
                    role="option"
                    id={`app-menu-search-option-${command.id}`}
                    aria-selected={index === activeIndex}
                    className={`app-menu-command${index === activeIndex ? ' is-active' : ''}`}
                    key={command.id}
                    onClick={() => runCommand(command)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="app-menu-command-main">
                      <i className={command.icon} aria-hidden="true" />
                      <span>{command.label}</span>
                    </span>
                    {command.hint && <kbd>{command.hint}</kbd>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="app-menu-bar-right">
        {isDesktopWindow && (
          <div className="app-menu-window-controls" aria-label="Window controls">
            <button type="button" className="app-menu-window-button" onClick={() => void runWindowCommand('minimize')} title="Minimize" aria-label="Minimize">
              <i className="fa-solid fa-minus" aria-hidden="true" />
            </button>
            <button type="button" className="app-menu-window-button" onClick={() => void runWindowCommand('toggleMaximize')} title={isMaximized ? 'Restore' : 'Maximize'} aria-label={isMaximized ? 'Restore' : 'Maximize'}>
              <i className={isMaximized ? 'fa-regular fa-window-restore' : 'fa-regular fa-square'} aria-hidden="true" />
            </button>
            <button type="button" className="app-menu-window-button is-close" onClick={() => void runWindowCommand('close')} title="Close" aria-label="Close">
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
