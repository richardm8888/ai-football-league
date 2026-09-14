import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Football League',
  description: 'Fantasy Football and Football Manager combined for the modern world.',
  applicationName: 'AI Football League',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'AIFL' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The tactics screen has small controls; pinch-zoom must stay available.
  maximumScale: 5,
  themeColor: '#071109',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
