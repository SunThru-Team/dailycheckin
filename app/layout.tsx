import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Daily check-in',
  description: 'Daily phone check-ins and executive briefing',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
