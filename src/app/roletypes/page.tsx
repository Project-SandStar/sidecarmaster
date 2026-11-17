import { Shell } from '@/components/Shell';
import { ModeEditor } from '@/components/control/ModeEditor';
import { listApps, listModeViews } from '@/lib/control/registry';

export const dynamic = 'force-dynamic';

export default async function RoleTypesPage() {
  const [apps, modes] = await Promise.all([listApps(), listModeViews()]);
  return (
    <Shell title="Role types">
      {apps.map((a) => {
        const mine = modes.filter((m) => m.appId === a.id);
        return (
          <div key={a.id} id={a.id} className="card space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{a.displayName}</span>
              <code className="text-xs text-gray-500">{a.id}</code>
              <span className="pill bg-gray-100 text-gray-600">{mine.length} {mine.length === 1 ? 'mode' : 'modes'}</span>
              {!a.enabled && <span className="pill bg-gray-100 text-gray-500">app off</span>}
            </div>
            <ModeEditor appId={a.id} modes={mine} />
          </div>
        );
      })}
      {apps.length === 0 && <p className="text-gray-500">No apps yet.</p>}
    </Shell>
  );
}
