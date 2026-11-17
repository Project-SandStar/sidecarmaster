/** In-process event bus for SSE `/api/v1/events`. One per server process. */
import { EventEmitter } from 'node:events';

export interface FleetEvent {
  type: string;            // e.g. 'role.set', 'app.update', 'control.push', 'reconcile.start', 'host.heartbeat'
  appId?: string | null;   // null/undefined = applies to every app
  hostId?: string | null;
  data?: unknown;
  at: string;
}

const g = globalThis as unknown as { __smBus?: EventEmitter };
function bus(): EventEmitter {
  if (!g.__smBus) { g.__smBus = new EventEmitter(); g.__smBus.setMaxListeners(200); }
  return g.__smBus;
}

export function publish(e: Omit<FleetEvent, 'at'>): void {
  bus().emit('event', { ...e, at: new Date().toISOString() } satisfies FleetEvent);
}

/** Subscribe; returns the unsubscribe function. */
export function subscribe(cb: (e: FleetEvent) => void): () => void {
  bus().on('event', cb);
  return () => { bus().off('event', cb); };
}
