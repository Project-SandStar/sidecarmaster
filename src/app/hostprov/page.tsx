import { Shell } from '@/components/Shell';
import { HostProvForm } from '@/components/control/HostProvForm';
import { ReconcileBanner } from '@/components/ReconcileBanner';
import { hostProvData } from '@/lib/control/pages';
import { reconcileOff } from '@/lib/control/reconcile-switch';

export const dynamic = 'force-dynamic';

export default async function HostProvPage() {
  const hosts = await hostProvData();
  return (
    <Shell title="Host provisioning">
      {(await reconcileOff()) && <ReconcileBanner>Settings here save only. &quot;Push config now&quot; sends nothing to the sidecars while reconcile is off.</ReconcileBanner>}
      {hosts.map((h) => <HostProvForm key={h.hostId} h={h} />)}
      {hosts.length === 0 && <p className="text-gray-500">No hosts yet.</p>}
    </Shell>
  );
}
