'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
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
    label: 'IDX Scanner',
    href: '/idx-scanner',
    icon: <i className="fa-regular fa-chart-bar" style={{ fontSize: '14px' }}></i>,
  },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [chatSessions, setChatSessions] = useState<{id: string, title: string}[]>([]);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const pathname = usePathname();

  const sanitizeSessionId = (id: unknown): string | null => {
    if (typeof id !== 'string') return null;
    return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
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
    if (collapsed) {
      document.body.classList.add('sidebar-collapsed');
    } else {
      document.body.classList.remove('sidebar-collapsed');
    }
  }, [collapsed]);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-logo" style={{ justifyContent: collapsed ? 'center' : 'space-between' }}>
        {!collapsed && <span className="sidebar-logo-text">BOZ.</span>}
        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
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
          <div key={item.href}>
            <Link
              href={item.href}
              className={`sidebar-link${isActive(item.href) ? ' active' : ''}`}
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              <span className="sidebar-link-label">{item.label}</span>
            </Link>
            {item.href === '/chat' && isActive('/chat') && chatSessions.length > 0 && !collapsed && (
              <div className="sidebar-recent-chats">
                <div className="sidebar-group-title">Recent Chats</div>
                {chatSessions.slice(0, 5).map(session => {
                  const chatHref = `/chat/${session.id}`;
                  return (
                    <Link 
                      key={session.id} 
                      href={chatHref}
                      className={`sidebar-chat-link${pathname === chatHref ? ' active' : ''}`}
                    >
                      {session.title}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        {isProfileMenuOpen && !collapsed && (
          <div className="profile-popover">
            <div className="profile-popover-header">
              <span className="profile-popover-email">ajaaoja@gmail.com</span>
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
              <button className="profile-popover-item">
                <div className="profile-popover-item-left">
                  <i className="fa-solid fa-globe"></i>
                  <span>Language</span>
                </div>
                <div className="profile-popover-item-right"><i className="fa-solid fa-chevron-right" style={{fontSize: '10px'}}></i></div>
              </button>
              <button className="profile-popover-item">
                <div className="profile-popover-item-left">
                  <i className="fa-regular fa-circle-question"></i>
                  <span>Get help</span>
                </div>
              </button>
            </div>
            <div className="profile-popover-group">
              <button className="profile-popover-item">
                <div className="profile-popover-item-left">
                  <i className="fa-solid fa-arrow-up"></i>
                  <span>Upgrade plan</span>
                </div>
              </button>
              <button className="profile-popover-item">
                <div className="profile-popover-item-left">
                  <i className="fa-solid fa-download"></i>
                  <span>Get apps and extensions</span>
                </div>
              </button>
              <button className="profile-popover-item">
                <div className="profile-popover-item-left">
                  <i className="fa-solid fa-circle-info"></i>
                  <span>Learn more</span>
                </div>
                <div className="profile-popover-item-right"><i className="fa-solid fa-chevron-right" style={{fontSize: '10px'}}></i></div>
              </button>
            </div>
            <div className="profile-popover-group">
              <button className="profile-popover-item">
                <div className="profile-popover-item-left">
                  <i className="fa-solid fa-arrow-right-from-bracket"></i>
                  <span>Log out</span>
                </div>
              </button>
            </div>
          </div>
        )}
        <div 
          className="sidebar-profile" 
          onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
          role="button"
          tabIndex={0}
        >
          <div className="sidebar-profile-avatar" aria-hidden="true">
            A
          </div>
          {!collapsed && (
            <div className="sidebar-profile-meta">
              <div className="sidebar-profile-name">aja</div>
              <div className="sidebar-profile-role">Free plan</div>
            </div>
          )}
          {!collapsed && (
            <div className="sidebar-profile-actions-wrapper">
              <div className="sidebar-profile-action" aria-label="Menu">
                <i className="fa-solid fa-sort" style={{ fontSize: '12px' }}></i>
              </div>
            </div>
          )}
        </div>
        <div className="sidebar-version-row">
          <span className="sidebar-version">v2.2.1</span>
        </div>
      </div>
    </aside>
  );
}
