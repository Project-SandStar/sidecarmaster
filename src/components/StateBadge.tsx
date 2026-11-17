import { STATE_CLASS, type CellState } from '@/lib/dashboard';

/** Container / cell state: green running, blue starting, slate created (never started), grey stopped, red error or down. */
export function StateBadge({ state }: { state: CellState }) {
  return <span className={`pill ${STATE_CLASS[state]}`} title={state === 'created' ? 'Docker made the container, but it never started.' : undefined}>{state}</span>;
}

export function UpBadge({ up }: { up: boolean }) {
  return (
    <span className={`pill ${up ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
      <span className={`dot ${up ? 'bg-green-500' : 'bg-red-500'}`} />{up ? 'up' : 'down'}
    </span>
  );
}

export const SEVERITY_CLASS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800', warning: 'bg-amber-100 text-amber-800', info: 'bg-blue-100 text-blue-800',
};
export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`pill ${SEVERITY_CLASS[severity] ?? 'bg-gray-100 text-gray-600'}`}>{severity}</span>;
}

const ALERT_STATE_CLASS: Record<string, string> = {
  open: 'bg-red-100 text-red-800', ack: 'bg-yellow-100 text-yellow-800', closed: 'bg-gray-100 text-gray-500',
};
export function AlertStateBadge({ state, muted }: { state: string; muted?: boolean }) {
  return <span className={`pill ${muted ? 'bg-gray-100 text-gray-500' : (ALERT_STATE_CLASS[state] ?? 'bg-gray-100 text-gray-600')}`}>{state}{muted ? ' (muted)' : ''}</span>;
}
