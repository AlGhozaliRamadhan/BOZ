import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';
import './globals.css';
import AppShell from './components/layout/AppShell';
const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BOZ',
  description: 'AI-powered market analysis engine',
  icons: {
    icon: [
      {
        url: '/logo-boz-transparant-black.png',
        type: 'image/png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/logo-boz-transparant-white.png',
        type: 'image/png',
        media: '(prefers-color-scheme: dark)',
      },
    ],
  },
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
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
