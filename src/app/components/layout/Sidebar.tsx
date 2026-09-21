'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggle: () => void;
}

const navItems: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/',
    icon: <i className="fa-regular fa-compass" style={{ fontSize: '14px' }}></i>,
  },
  {
    label: 'Chat Agent',
    href: '/chat',
    icon: <i className="fa-regular fa-comment-dots" style={{ fontSize: '14px' }}></i>,
  },
  {
    label: 'Screeners',
    href: '/idx-scanner',
    icon: <i className="fa-regular fa-chart-bar" style={{ fontSize: '14px' }}></i>,
  },
];

export default function Sidebar({ collapsed, mobileOpen, onToggle }: SidebarProps) {
  const router = useRouter();
  const [chatSessions, setChatSessions] = useState<{id: string, title: string}[]>([]);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!isProfileMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isProfileMenuOpen]);

  const sanitizeSessionId = (id: unknown): string | null => {
    if (typeof id !== 'string') return null;
    return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
  };

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const stored = localStorage.getItem('boz_chat_sessions');
      if (stored) {
        const parsed = JSON.parse(stored);
        const updated = parsed.filter((s: any) => s.id !== id);
        localStorage.setItem('boz_chat_sessions', JSON.stringify(updated));
        setChatSessions((prev) => prev.filter((s) => s.id !== id));
        window.dispatchEvent(new Event('boz_chat_updated'));
        if (pathname === `/chat/${id}`) {
          router.push('/chat');
          window.dispatchEvent(new Event('boz_new_chat'));
        }
      }
    } catch (err) {
      console.error('Failed to delete session', err);
    }
  };

  useEffect(() => {
    const loadSessions = () => {
      try {
        const stored = localStorage.getItem('boz_chat_sessions');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (!Array.isArray(parsed)) {
            setChatSessions([]);
            return;
          }
          const sessions = parsed
            .map((s: any) => {
              const safeId = sanitizeSessionId(s?.id);
              if (!safeId || typeof s?.title !== 'string') return null;
              return { id: safeId, title: s.title, updatedAt: Number(s?.updatedAt) || 0 };
            })
            .filter((s): s is { id: string; title: string; updatedAt: number } => s !== null);
          sessions.sort((a, b) => b.updatedAt - a.updatedAt);
          setChatSessions(sessions.map(({ id, title }) => ({ id, title })));
        } else {
          setChatSessions([]);
        }
      } catch (e) {
        setChatSessions([]);
      }
    };
    loadSessions();
    window.addEventListener('boz_chat_updated', loadSessions);
    return () => window.removeEventListener('boz_chat_updated', loadSessions);
  }, []);

  useEffect(() => {
    const handleOpenAbout = () => setIsUpdateModalOpen(true);
    window.addEventListener('boz_open_about', handleOpenAbout);
    return () => window.removeEventListener('boz_open_about', handleOpenAbout);
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
      <div className="sidebar-toolbar" style={{ justifyContent: collapsed ? 'center' : 'flex-end' }}>
        <button
          className="sidebar-collapse-btn"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            {collapsed ? (
              <polyline points="6,3 11,8 6,13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <polyline points="10,3 5,8 10,13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <div key={item.href} className="sidebar-nav-item-group">
            <Link
              href={item.href}
              className={`sidebar-link${isActive(item.href) ? ' active' : ''}`}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              <span className="sidebar-link-label">{item.label}</span>
            </Link>
            {item.href === '/chat' && isActive('/chat') && !collapsed && (
              <div className="sidebar-chat-subnav animate-fadeIn">
                <Link
                  href="/chat"
                  onClick={() => {
                    window.dispatchEvent(new Event('boz_new_chat'));
                  }}
                  className="sidebar-new-chat-btn"
                  title="Start a fresh conversation"
                >
                  <i className="fa-solid fa-plus" style={{ fontSize: '11px' }}></i>
                  <span>New Chat</span>
                </Link>

                {chatSessions.length > 0 && (
                  <div className="sidebar-recent-chats">
                    <div className="sidebar-group-title">Recent Chats</div>
                    {chatSessions.slice(0, 10).map((session) => {
                      const chatHref = `/chat/${session.id}`;
                      const isSelected = pathname === chatHref;
                      return (
                        <div key={session.id} className={`sidebar-chat-item-wrapper${isSelected ? ' active' : ''}`}>
                          <Link 
                            href={chatHref}
                            className={`sidebar-chat-link${isSelected ? ' active' : ''}`}
                            title={session.title}
                          >
                            <i className="fa-regular fa-message sidebar-chat-icon"></i>
                            <span className="sidebar-chat-title">{session.title}</span>
                          </Link>
                          <button
                            type="button"
                            className="sidebar-chat-delete-btn"
                            onClick={(e) => deleteSession(e, session.id)}
                            title="Delete chat"
                            aria-label="Delete chat"
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer" ref={profileRef}>
        {isProfileMenuOpen && !collapsed && (
          <div className="profile-popover animate-fadeIn">
            <div className="profile-popover-header">
              <span className="profile-popover-email">User</span>
            </div>
            <div className="profile-popover-group">
              <button 
                className="profile-popover-item"
                onClick={() => {
                  window.dispatchEvent(new Event('boz_open_settings'));
                  setIsProfileMenuOpen(false);
                }}
              >
                <div className="profile-popover-item-left">
                  <i className="fa-solid fa-gear"></i>
                  <span>Settings</span>
                </div>
                <div className="profile-popover-item-right">Ctrl+⇧+,</div>
              </button>
              <button 
                className="profile-popover-item"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  setIsUpdateModalOpen(true);
                }}
              >
                <div className="profile-popover-item-left">
                  <i className="fa-solid fa-circle-info"></i>
                  <span>About BOZ</span>
                </div>
              </button>
            </div>
          </div>
        )}
        <div 
          className="sidebar-profile" 
          onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setIsProfileMenuOpen(current => !current);
            }
          }}
          role="button"
          tabIndex={0}
          aria-expanded={isProfileMenuOpen}
          title={collapsed ? 'Open profile menu' : undefined}
        >
          <div className="sidebar-profile-avatar" style={{ position: 'relative' }} aria-hidden="true">
            <i className="fa-solid fa-user" style={{ fontSize: '13px', opacity: 0.85 }}></i>
          </div>
          {!collapsed && (
            <div className="sidebar-profile-meta">
              <div className="sidebar-profile-name">User</div>
            </div>
          )}
          {!collapsed && (
            <div className="sidebar-profile-actions-wrapper">
              <div className="sidebar-profile-action" aria-label="Menu">
                <i className="fa-solid fa-ellipsis" style={{ fontSize: '13px' }}></i>
              </div>
            </div>
          )}
        </div>
        <div className="sidebar-version-row">
          <span className="sidebar-version">
            v{process.env.NEXT_PUBLIC_BOZ_VERSION ?? '2.7.1'}
          </span>
        </div>
      </div>

      {/* Desktop About Modal */}
      {isUpdateModalOpen && (
        <div className="update-modal-overlay" onClick={() => setIsUpdateModalOpen(false)}>
          <div className="update-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="update-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <img src="/logo-boz-transparant-white.png" alt="BOZ" style={{ width: '24px', height: '24px', borderRadius: '4px' }} />
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  About BOZ
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsUpdateModalOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="update-modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  BOZ Intelligence
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Desktop version v{process.env.NEXT_PUBLIC_BOZ_VERSION ?? '2.7.1'}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.6, marginTop: '4px' }}>
                  Signed updates are managed by the BOZ desktop application. Use <strong>Check for updates</strong> from the system tray.
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <button
                  type="button"
                  onClick={() => setIsUpdateModalOpen(false)}
                  style={{ padding: '8px 16px', borderRadius: '6px', background: 'var(--text-primary)', color: 'var(--bg-primary)', border: 'none', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
