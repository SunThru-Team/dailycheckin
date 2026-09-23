'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Tabs({ token, pending }: { token: string; pending: number }) {
  const path = usePathname();
  const base = `/x/${token}`;
  const tabs = [
    { href: base, label: 'Briefing' },
    { href: `${base}/priorities`, label: 'Priorities' },
    { href: `${base}/tasks`, label: 'Tasks', badge: pending || undefined },
  ];
  return (
    <nav className="tabs">
      {tabs.map((t) => {
        const active = t.href === base ? path === base : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={active ? 'tab active' : 'tab'}>
            {t.label}
            {t.badge ? <span className="badge">{t.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
