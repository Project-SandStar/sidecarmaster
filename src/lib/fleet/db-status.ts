/**
 * Fallback FleetStatus from the Host table (Sound Suite import snapshot).
 * Used until Phase 2's relay registers the live status with setFleetStatus().
 */
import { prisma } from '../db';
import type { ContainerLive, FleetStatus, HostLive } from './interfaces';

interface Snap { status?: string | null; mode?: string | null; containers?: unknown; gpus?: unknown; activeRequests?: unknown }

function parse(s: string | null): Snap | null {
  if (!s) return null;
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? (v as Snap) : null; } catch { return null; }
}

/** Sound Suite stores containers as a record keyed by role, or as an array. */
export function snapContainers(c: unknown): ContainerLive[] {
  const one = (k: string | null, v: unknown): ContainerLive => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const str = (x: unknown) => (typeof x === 'string' ? x : null);
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const cfg = (o.config && typeof o.config === 'object' ? o.config : {}) as Record<string, unknown>;
    // Sound Suite sidecars send loadedModels: [{name,size}] or models: ["name"].
    const lm = Array.isArray(o.loadedModels) ? o.loadedModels : Array.isArray(o.models) ? o.models : [];
    const loadedModels = lm
      .map((m) => (typeof m === 'string' ? { name: m } : m && typeof m === 'object' ? (m as Record<string, unknown>) : {}))
      .filter((m) => typeof m.name === 'string' && m.name)
      .map((m) => ({ name: m.name as string, size: num(m.size) }));
    return {
      ...(loadedModels.length ? { loadedModels } : {}),
      name: str(o.name) ?? k ?? '?', role: k ?? str(o.role), state: str(o.status) ?? str(o.state) ?? 'unknown',
      // Sound Suite /status puts the resolved port in config.port (after the host-Ollama / DMR rewrite).
      image: str(o.image), port: num(o.port) ?? num(cfg.port), model: str(o.model) ?? str(cfg.model),
    };
  };
  if (Array.isArray(c)) return c.map((v) => one(null, v));
  if (c && typeof c === 'object') return Object.entries(c as Record<string, unknown>).map(([k, v]) => one(k, v));
  return [];
}

type HostRow = Awaited<ReturnType<typeof prisma.host.findMany>>[number];

export function hostRowToLive(h: HostRow): HostLive {
  const s = parse(h.statusSnapshot);
  const st = (s?.status ?? '').toLowerCase();
  return {
    hostId: h.id, name: h.name,
    online: st === 'connected' || st === 'online' || st === 'healthy',
    lastHeartbeatAt: h.lastHeartbeatAt, os: h.hostOsOverride ?? h.os, hostname: h.hostname, sidecarVersion: h.sidecarVersion,
    versions: h.sidecarVersion ? { 'docker-sidecar': h.sidecarVersion } : {},
    netbirdIp: h.netbirdIp, address: h.agentUrl ?? h.peerAddress,
    activeRequests: typeof s?.activeRequests === 'number' ? s.activeRequests : null,
    containers: snapContainers(s?.containers), gpus: [], masters: [], roles: [], errors: [],
  };
}

export function dbFleetStatus(): FleetStatus {
  return {
    async list() { return (await prisma.host.findMany({ orderBy: { name: 'asc' } })).map(hostRowToLive); },
    async get(id) { const h = await prisma.host.findUnique({ where: { id } }); return h ? hostRowToLive(h) : null; },
  };
}
