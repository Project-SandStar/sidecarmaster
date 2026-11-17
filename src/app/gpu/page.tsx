import { Shell } from '@/components/Shell';
import { HostCards } from '@/components/HostCards';
import { ReconcileBanner } from '@/components/ReconcileBanner';
import { fleetRows } from '@/lib/fleet';
import { getFleetControl } from '@/lib/fleet/interfaces';
import { reconcileSwitch } from '@/lib/control/reconcile-switch';

export const dynamic = 'force-dynamic';

/** Hosts: one card per host with GPU, versions, heartbeat and the roles as chips (Sound Suite GPU Fleet look). */
export default async function HostsPage() {
  const rows = await fleetRows();
  const sw = await reconcileSwitch();
  const off = !sw.on;
  return (
    <Shell title="Hosts">
      {off && <ReconcileBanner reason={sw.reason} />}
      {/* eslint-disable-next-line react-hooks/purity -- server render time for "ago" labels */}
      <HostCards initial={rows} initialNow={Date.now()} reconcileOff={off} canAct={!!getFleetControl()} />
    </Shell>
  );
}
