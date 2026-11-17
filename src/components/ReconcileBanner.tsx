import Link from 'next/link';

/** Shown while reconcile is off: nothing on the page pushes config or starts or stops containers. */
export function ReconcileBanner({ children, reason }: { children?: React.ReactNode; reason?: string | null }) {
  return (
    <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-banner="reconcile-off">
      <b>Reconcile is off{reason ? ` (${reason})` : ''}.</b>{' '}
      {children ?? 'This page only shows what the sidecars report. Nothing here pushes config or starts or stops containers. Sound Suite stays in charge of the containers.'}{' '}
      <Link href="/settings?tab=reconcile" className="text-blue-700 underline whitespace-nowrap">Reconcile settings →</Link>
    </p>
  );
}
