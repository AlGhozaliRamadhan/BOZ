import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BOZ',
  description: 'AI-powered market analysis engine',
  icons: { icon: '/logo-boz.png' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" className={outfit.variable}>
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
      </head>
      <body>
        <div className="app-layout">
          <Sidebar />
          <div className="app-main">
            <TopBar />
            <main className="app-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
