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
    icon: <i className="fa-solid fa-house" style={{ fontSize: '18px' }}></i>,
  },
  {
    label: 'Chat Agent',
    href: '/chat',
    icon: <i className="fa-solid fa-comment-dots" style={{ fontSize: '18px' }}></i>,
  },
  {
    label: 'IDX Scanner',
    href: '/idx-scanner',
    icon: <i className="fa-solid fa-magnifying-glass-chart" style={{ fontSize: '18px' }}></i>,
  },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [chatSessions, setChatSessions] = useState<{id: string, title: string}[]>([]);
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

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-logo">
        <span className="sidebar-logo-text">BOZ</span>
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
              <div style={{ paddingLeft: '40px', marginTop: '4px', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '180px', overflowY: 'auto' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Recent Chats</div>
                {chatSessions.slice(0, 5).map(session => {
                  const chatHref = `/chat/${session.id}`;
                  return (
                    <Link 
                      key={session.id} 
                      href={chatHref}
                      style={{ fontSize: '12px', color: pathname === chatHref ? 'var(--text-primary)' : 'var(--text-muted)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '4px 0' }}
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

      <div className="sidebar-footer" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '16px' }}>
        <Link
          href="/settings"
          className={`sidebar-link${isActive('/settings') ? ' active' : ''}`}
          style={{ width: '100%', padding: '8px 12px', marginBottom: '8px', justifyContent: collapsed ? 'center' : 'flex-start' }}
        >
          <span className="sidebar-link-icon">
            <i className="fa-solid fa-gear" style={{ fontSize: '18px' }}></i>
          </span>
          <span className="sidebar-link-label">Settings</span>
        </Link>
        <div style={{ display: 'flex', justifyContent: collapsed ? 'center' : 'space-between', alignItems: 'center', width: '100%' }}>
          {!collapsed && <span className="sidebar-version" style={{ fontSize: '10px' }}>v2.1.1</span>}
          <button
            className="sidebar-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
      </div>
    </aside>
  );
}
