'use client';

import { useState } from 'react';
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
    label: 'Intraday Analysis',
    href: '/analyze/intraday',
    icon: <i className="fa-solid fa-chart-line" style={{ fontSize: '18px' }}></i>,
  },
  {
    label: 'Long-term Analysis',
    href: '/analyze/longterm',
    icon: <i className="fa-solid fa-chart-pie" style={{ fontSize: '18px' }}></i>,
  },
  {
    label: 'News Intel',
    href: '/news-intel',
    icon: <i className="fa-regular fa-newspaper" style={{ fontSize: '18px' }}></i>,
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
  const pathname = usePathname();

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
          <Link
            key={item.href}
            href={item.href}
            className={`sidebar-link${isActive(item.href) ? ' active' : ''}`}
          >
            <span className="sidebar-link-icon">{item.icon}</span>
            <span className="sidebar-link-label">{item.label}</span>
          </Link>
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
          {!collapsed && <span className="sidebar-version" style={{ fontSize: '10px' }}>v2.0.0</span>}
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
