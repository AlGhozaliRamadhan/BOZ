'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getShellNavigationTarget } from './shell-menu';

type MenuId = 'file' | 'edit' | 'view' | 'help';

interface AppMenuBarProps {
  sidebarCollapsed: boolean;
  tickerVisible: boolean;
  onToggleSidebar: () => void;
  onToggleTicker: () => void;
  onResetLayout: () => void;
}

function dispatchShellEvent(name: string): void {
  window.dispatchEvent(new Event(name));
}

export default function AppMenuBar({
  sidebarCollapsed,
  tickerVisible,
  onToggleSidebar,
  onToggleTicker,
  onResetLayout,
}: AppMenuBarProps) {
  const router = useRouter();
  const menuRootRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
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

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        onToggleSidebar();
        setOpenMenu(null);
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        router.push(getShellNavigationTarget('newChat'));
        dispatchShellEvent('boz_new_chat');
        setOpenMenu(null);
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === ',') {
        event.preventDefault();
        dispatchShellEvent('boz_open_settings');
        setOpenMenu(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onToggleSidebar, router]);

  const closeMenu = () => setOpenMenu(null);
  const toggleMenu = (menu: MenuId) => setOpenMenu(current => current === menu ? null : menu);

  const newChat = () => {
    router.push(getShellNavigationTarget('newChat'));
    dispatchShellEvent('boz_new_chat');
    closeMenu();
  };

  const runEditCommand = (command: 'copy' | 'selectAll') => {
    document.execCommand(command === 'copy' ? 'copy' : 'selectAll');
    closeMenu();
  };

  const openSettings = () => {
    dispatchShellEvent('boz_open_settings');
    closeMenu();
  };

  const openAbout = () => {
    dispatchShellEvent('boz_open_about');
    closeMenu();
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
    if ((event.target as HTMLElement).closest('button, a, [role="menu"]')) return;
    void runWindowCommand('toggleMaximize');
  };

  const handleTitleBarMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button, a, input, [role="menu"], [role="menuitem"]')) return;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().startDragging();
      } catch {
        // Native drag region already handles the gesture.
      }
    })();
  };

  const menus: Array<{ id: MenuId; label: string; items: Array<{ label: string; icon: string; shortcut?: string; onSelect: () => void }> }> = [
    {
      id: 'file',
      label: 'File',
      items: [
        { label: 'New Chat', icon: 'fa-regular fa-pen-to-square', shortcut: 'Ctrl+N', onSelect: newChat },
        { label: 'Dashboard', icon: 'fa-regular fa-compass', onSelect: () => { router.push(getShellNavigationTarget('dashboard')); closeMenu(); } },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { label: 'Copy', icon: 'fa-regular fa-copy', shortcut: 'Ctrl+C', onSelect: () => runEditCommand('copy') },
        { label: 'Select All', icon: 'fa-regular fa-square-check', shortcut: 'Ctrl+A', onSelect: () => runEditCommand('selectAll') },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        {
          label: sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar',
          icon: 'fa-solid fa-bars',
          shortcut: 'Ctrl+B',
          onSelect: () => { onToggleSidebar(); closeMenu(); },
        },
        {
          label: tickerVisible ? 'Hide Market Ticker' : 'Show Market Ticker',
          icon: 'fa-solid fa-chart-line',
          onSelect: () => { onToggleTicker(); closeMenu(); },
        },
        { label: 'Reset Layout', icon: 'fa-solid fa-arrow-rotate-left', onSelect: () => { onResetLayout(); closeMenu(); } },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { label: 'Settings', icon: 'fa-solid fa-gear', shortcut: 'Ctrl+Shift+,', onSelect: openSettings },
        { label: 'About BOZ', icon: 'fa-solid fa-circle-info', onSelect: openAbout },
      ],
    },
  ];

  return (
    <header className="app-menu-bar" data-tauri-drag-region onMouseDown={handleTitleBarMouseDown} onDoubleClick={handleTitleBarDoubleClick}>
      <div className="app-menu-bar-left" ref={menuRootRef} data-tauri-drag-region>
        <Link href="/" className="app-menu-brand" aria-label="BOZ home">
          <img src="/logo-boz-transparant-white.png" alt="" aria-hidden="true" />
          <span>BOZ</span>
        </Link>
        <nav className="app-menu-items" aria-label="Application menu">
          {menus.map(menu => (
            <div className="app-menu-item" key={menu.id}>
              <button
                type="button"
                className={`app-menu-trigger${openMenu === menu.id ? ' is-open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={openMenu === menu.id}
                onClick={() => toggleMenu(menu.id)}
              >
                {menu.label}
              </button>
              {openMenu === menu.id && (
                <div className="app-menu-dropdown" role="menu" aria-label={`${menu.label} menu`}>
                  {menu.items.map(item => (
                    <button type="button" role="menuitem" className="app-menu-command" key={item.label} onClick={item.onSelect}>
                      <span className="app-menu-command-main">
                        <i className={item.icon} aria-hidden="true" />
                        <span>{item.label}</span>
                      </span>
                      {item.shortcut && <kbd>{item.shortcut}</kbd>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

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
    </header>
  );
}
