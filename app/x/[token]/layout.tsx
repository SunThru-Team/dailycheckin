import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdminToken } from '@/lib/auth';
import { countPendingSuggestions } from '@/lib/tasks';
import { Tabs } from '@/components/Tabs';

export const dynamic = 'force-dynamic';

export default async function ExecLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isAdminToken(token)) notFound();
  const pending = await countPendingSuggestions();

  return (
    <main className="page wide">
      <header className="top exec">
        <div>
          <h1><Link href={`/x/${token}`} style={{ color: 'inherit' }}>SunThru</Link></h1>
          <p className="who">Company view</p>
        </div>
      </header>
      <Tabs token={token} pending={pending} />
      {children}
    </main>
  );
}
