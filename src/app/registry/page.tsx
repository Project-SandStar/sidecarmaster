import { Shell } from '@/components/Shell';
import { AppRegistry } from '@/components/control/AppRegistry';
import { listApps } from '@/lib/control/registry';

export const dynamic = 'force-dynamic';

export default async function RegistryPage() {
  return (
    <Shell title="App registry">
      <AppRegistry apps={await listApps()} />
    </Shell>
  );
}
