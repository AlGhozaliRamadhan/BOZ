'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import DesktopUpdateControl from '../ui/DesktopUpdateControl';
import {
  getSessionStatus,
  loadListedSessions,
} from '../../chat/_lib/chat-sessions';
import { isStreamActive, stopStream } from '../../chat/_lib/chat-stream-manager';
import type { ChatGenerationStatus } from '@/shared/chat-generation-status';
import {
  DEFAULT_PROFILE,
  PROFILE_EVENT,
  profileInitial,
  readProfile,
  type UserProfile,
} from './profile-state';

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
    icon: <i className="fa-regular fa-compass"></i>,
  },
  {
    label: 'Chat Agent',
    href: '/chat',
    icon: <i className="fa-regular fa-comment-dots"></i>,
  },
  {
    label: 'Screeners',
    href: '/screener',
    icon: <i className="fa-regular fa-chart-bar"></i>,
  },
];

export default function Sidebar({ collapsed, mobileOpen, onToggle }: SidebarProps) {
  const router = useRouter();
  interface RecentChatEntry {
    id: string;
    title: string;
    status: ChatGenerationStatus;
  }

  const [chatSessions, setChatSessions] = useState<RecentChatEntry[]>([]);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
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

  const deleteSession = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      // Stop a live generation first: otherwise the background stream would
      // re-persist progress into a session the user just deleted.
      stopStream(id);
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

  // Recent chats read through the session store, so every row carries its
  // generation status: streaming (still generating elsewhere), done,
  // error/interrupted (needs attention), or cancelled (stopped by the user).
  // Reconcile once on mount — not on every update event — so a reload that
  // lands outside the chat (e.g. the dashboard) never leaves a spinner stuck
  // on an orphaned generation. Per-event reconcile would race a just-sent
  // user message: its persist announces before startStream registers the
  // live runner, and the trailing user turn would read as orphaned. The
  // persisted rollup is the source of truth afterwards: the stream manager
  // stamps it on every persist, finish, and stop.
  useEffect(() => {
    const loadSessions = (reconcile: boolean) => {
      try {
        const sessions = loadListedSessions(window.localStorage, isStreamActive, reconcile);
        setChatSessions(
          sessions.map((session) => ({
            id: session.id,
            title: session.title,
            status: getSessionStatus(session),
          })),
        );
      } catch (e) {
        setChatSessions([]);
      }
    };
    loadSessions(true);
    const handleUpdated = () => loadSessions(false);
    window.addEventListener('boz_chat_updated', handleUpdated);
    return () => window.removeEventListener('boz_chat_updated', handleUpdated);
  }, []);

  useEffect(() => {
    const handleOpenAbout = () => setIsUpdateModalOpen(true);
    window.addEventListener('boz_open_about', handleOpenAbout);
    return () => window.removeEventListener('boz_open_about', handleOpenAbout);
  }, []);

  useEffect(() => {
    const syncProfile = () => {
      try {
        setProfile(readProfile(window.localStorage));
      } catch {
        setProfile(DEFAULT_PROFILE);
      }
    };
    syncProfile();
    window.addEventListener(PROFILE_EVENT, syncProfile);
    return () => window.removeEventListener(PROFILE_EVENT, syncProfile);
  }, []);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
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
            {item.href === '/chat' && !collapsed && (
              <div className="sidebar-chat-subnav animate-fadeIn">
                {isActive('/chat') && (
                  <Link
                    href="/chat"
                    onClick={() => {
                      window.dispatchEvent(new Event('boz_new_chat'));
                    }}
                    className="sidebar-new-chat-btn"
                    title="Start a fresh conversation"
                  >
                    <i className="fa-solid fa-plus"></i>
                    <span>New Chat</span>
                  </Link>
                )}

                {chatSessions.length > 0 && (
                  <div className="sidebar-recent-chats">
                    <div className="sidebar-group-title">Recent Chats</div>
                    {chatSessions.slice(0, 10).map((session) => {
                      const chatHref = `/chat/${session.id}`;
                      const isSelected = pathname === chatHref;
                      const statusLabel =
                        session.status === 'streaming'
                          ? 'Generating…'
                          : session.status === 'error' || session.status === 'interrupted'
                            ? 'Needs attention'
                            : session.status === 'cancelled'
                              ? 'Stopped'
                              : 'Finished';
                      return (
                        <div key={session.id} className={`sidebar-chat-item-wrapper${isSelected ? ' active' : ''} sidebar-chat-status-${session.status}`}>
                          <Link 
                            href={chatHref}
                            className={`sidebar-chat-link${isSelected ? ' active' : ''}`}
                            title={`${session.title} — ${statusLabel}`}
                          >
                            {session.status === 'streaming' ? (
                              <span className="sidebar-chat-status-icon is-generating" aria-label="Generating">
                                <span className="spinner spinner-xs" aria-hidden="true" />
                              </span>
                            ) : (
                              <i
                                className={`sidebar-chat-icon ${
                                  session.status === 'done' || session.status === undefined
                                    ? 'fa-regular fa-message'
                                    : session.status === 'cancelled'
                                      ? 'fa-regular fa-circle-stop'
                                      : 'fa-solid fa-triangle-exclamation'
                                }`}
                                aria-label={statusLabel}
                              />
                            )}
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

      <button
        type="button"
        className="sidebar-collapse-btn"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          {collapsed ? (
            <polyline points="6,3 11,8 6,13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <polyline points="10,3 5,8 10,13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </button>

      <div className="sidebar-footer" ref={profileRef}>
        {isProfileMenuOpen && (
          <div className="profile-popover animate-fadeIn">
            <div className="profile-popover-header profile-popover-identity">
              <span className="profile-popover-avatar" style={{ background: profile.avatarColor }} aria-hidden="true">
                {profileInitial(profile.displayName) || <i className="fa-solid fa-user"></i>}
              </span>
              <span className="profile-popover-identity-text">
                <span className="profile-popover-email">{profile.displayName}</span>
                {profile.status && <span className="profile-popover-status">{profile.status}</span>}
              </span>
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
          <div className="sidebar-profile-avatar" style={{ position: 'relative', background: profile.avatarColor, borderColor: 'transparent', color: '#fff' }} aria-hidden="true">
            {profileInitial(profile.displayName) || <i className="fa-solid fa-user" style={{ fontSize: '13px', opacity: 0.85 }}></i>}
          </div>
          {!collapsed && (
            <div className="sidebar-profile-meta">
              <div className="sidebar-profile-name">{profile.displayName}</div>
              {profile.status && <div className="sidebar-profile-role">{profile.status}</div>}
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
        {!collapsed && (
          <div className="sidebar-version-row">
            <span className="sidebar-version">
              v{process.env.NEXT_PUBLIC_BOZ_VERSION ?? '2.7.4'}
            </span>
          </div>
        )}
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
                  Desktop version v{process.env.NEXT_PUBLIC_BOZ_VERSION ?? '2.7.4'}
                </div>
              </div>
              <DesktopUpdateControl version={process.env.NEXT_PUBLIC_BOZ_VERSION ?? '2.7.4'} />
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '12px', borderTop: '1px solid var(--border-glass)' }}>
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
