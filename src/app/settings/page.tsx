import { Shell } from '@/components/Shell';
import { SettingsTabs } from '@/components/SettingsTabs';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <Shell title="Settings"><SettingsTabs initial={tab} /></Shell>;
}
