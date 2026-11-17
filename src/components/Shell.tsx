import Link from 'next/link';
import { requirePageUser } from '@/lib/session';
import { LogoutButton } from './LogoutButton';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/gpu', label: 'Hosts' },
  { href: '/registry', label: 'App registry' },
  { href: '/apps', label: 'Apps' },
  { href: '/alerts', label: 'Alerts' },
  { href: '/releases', label: 'Releases' },
  { href: '/roletypes', label: 'Role types' },
  { href: '/roleassign', label: 'Role assignments' },
  { href: '/hostprov', label: 'Host provisioning' },
  { href: '/audit', label: 'Audit log' },
  { href: '/settings', label: 'Settings' },
];

/** Page frame for logged-in admins. Redirects to /login without a session. */
export async function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const u = await requirePageUser();
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-white border-r border-gray-200 p-4 space-y-1">
        <div className="font-semibold text-lg mb-4 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={24} height={24} className="w-6 h-6" />
          sidecarmaster
        </div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="block px-3 py-2 rounded-lg text-sm hover:bg-gray-100">{n.label}</Link>
        ))}
        <div className="pt-6 text-xs text-gray-500">Signed in as {u.username}</div>
        <LogoutButton />
      </aside>
      <main className="flex-1 p-8 space-y-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {children}
      </main>
    </div>
  );
}
