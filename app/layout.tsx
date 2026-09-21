import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Daily check-in',
  description: 'Daily phone check-ins and executive briefing',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&family=Newsreader:ital,opsz,wght@0,6..72,400..700;1,6..72,400..700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="topbar">
          <span className="brand">SunThru</span>
          <span className="app">Daily check-in</span>
        </div>
        {children}
      </body>
    </html>
  );
}
