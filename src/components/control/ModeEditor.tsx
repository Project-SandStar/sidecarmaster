'use client';
/** Role types editor (port of Sound Suite admin-role-types.tsx), per app. Add, edit, delete modes. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ModeView } from '@/lib/control/registry';
import { call, Msg } from './api';

const OS = ['linux', 'mac-docker-ollama', 'windows-docker-wsl2'];
const RT = ['docker-ollama', 'docker-vllm', 'docker-cpu', 'host', 'docker-model-runner'];

interface Draft {
  name: string; label: string; description: string; kind: string; image: string; port: string; vramMb: string;
  requiresGpu: boolean; availableOn: string[]; runtimes: string[]; env: string; defaultModels: string;
}

const toDraft = (m?: ModeView): Draft => ({
  name: m?.name ?? '', label: m?.label ?? '', description: m?.description ?? '', kind: m?.kind ?? 'ollama',
  image: m?.image ?? 'ollama/ollama', port: m?.port ? String(m.port) : '', vramMb: m?.vramMb ? String(m.vramMb) : '',
  requiresGpu: m?.requiresGpu ?? true, availableOn: m?.availableOn ?? OS, runtimes: m?.runtimes ?? ['docker-ollama'],
  env: JSON.stringify(m?.env ?? {}), defaultModels: JSON.stringify(m?.defaultModels ?? {}),
});

function body(d: Draft) {
  let env: unknown, defaultModels: unknown;
  try { env = JSON.parse(d.env || '{}'); } catch { throw new Error('env must be JSON, e.g. {"KEY":"value"}'); }
  try { defaultModels = JSON.parse(d.defaultModels || '{}'); } catch { throw new Error('models must be JSON, e.g. {"default":"qwen3:8b"}'); }
  return {
    label: d.label || null, description: d.description || null, kind: d.kind, image: d.image || null,
    port: d.port ? Number(d.port) : null, vramMb: d.vramMb ? Number(d.vramMb) : null, requiresGpu: d.requiresGpu,
    availableOn: d.availableOn, runtimes: d.runtimes, env, defaultModels,
  };
}

function Form({ appId, mode, onDone }: { appId: string; mode?: ModeView; onDone: (m: { ok: boolean; text: string }) => void }) {
  const router = useRouter();
  const [d, setD] = useState<Draft>(toDraft(mode));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Draft, v: unknown) => setD({ ...d, [k]: v });
  const toggle = (k: 'availableOn' | 'runtimes', v: string) => set(k, d[k].includes(v) ? d[k].filter((x) => x !== v) : [...d[k], v]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      if (mode) await call(`/api/apps/${appId}/modes/${mode.name}`, 'PUT', body(d));
      else await call(`/api/apps/${appId}/modes`, 'POST', { name: d.name, ...body(d) });
      onDone({ ok: true, text: `Saved ${mode?.name ?? d.name}.` });
      if (!mode) setD(toDraft());
      router.refresh();
    } catch (err) { onDone({ ok: false, text: (err as Error).message }); }
    setBusy(false);
  }
  async function remove() {
    if (!mode || !confirm(`Delete mode ${mode.name}?`)) return;
    setBusy(true);
    try { await call(`/api/apps/${appId}/modes/${mode.name}`, 'DELETE'); onDone({ ok: true, text: `Deleted ${mode.name}.` }); router.refresh(); }
    catch (err) { onDone({ ok: false, text: (err as Error).message }); }
    setBusy(false);
  }
  return (
    <form onSubmit={save} className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm border-t border-gray-100 pt-3">
      {!mode && <label>Name<input className="input font-mono" value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="axon-embedding" /></label>}
      {mode && <div className="font-mono font-medium self-end">{mode.name}</div>}
      <label>Label<input className="input" value={d.label} onChange={(e) => set('label', e.target.value)} /></label>
      <label>Kind<select className="input" value={d.kind} onChange={(e) => set('kind', e.target.value)}>{['ollama', 'vllm', 'utility'].map((k) => <option key={k}>{k}</option>)}</select></label>
      <label>Image<input className="input font-mono text-xs" value={d.image} onChange={(e) => set('image', e.target.value)} /></label>
      <label>Port<input className="input" type="number" value={d.port} onChange={(e) => set('port', e.target.value)} /></label>
      <label>VRAM (MB)<input className="input" type="number" value={d.vramMb} onChange={(e) => set('vramMb', e.target.value)} /></label>
      <label>Models (JSON per OS)<input className="input font-mono text-xs" value={d.defaultModels} onChange={(e) => set('defaultModels', e.target.value)} /></label>
      <label>Env (JSON)<input className="input font-mono text-xs" value={d.env} onChange={(e) => set('env', e.target.value)} /></label>
      <div className="col-span-2">Runs on: {OS.map((o) => <label key={o} className="mr-3"><input type="checkbox" checked={d.availableOn.includes(o)} onChange={() => toggle('availableOn', o)} /> {o}</label>)}</div>
      <div className="col-span-2">Runtimes: {RT.map((o) => <label key={o} className="mr-3"><input type="checkbox" checked={d.runtimes.includes(o)} onChange={() => toggle('runtimes', o)} /> {o}</label>)}</div>
      <label className="col-span-2 md:col-span-3">Description<input className="input" value={d.description} onChange={(e) => set('description', e.target.value)} /></label>
      <div className="flex items-end gap-2">
        <label><input type="checkbox" checked={d.requiresGpu} onChange={(e) => set('requiresGpu', e.target.checked)} /> GPU</label>
        <button className="btn" disabled={busy}>{mode ? 'Save' : 'Add mode'}</button>
        {mode && <button type="button" className="btn-ghost" disabled={busy} onClick={remove}>Delete</button>}
      </div>
    </form>
  );
}

export function ModeEditor({ appId, modes }: { appId: string; modes: ModeView[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <table className="tbl">
        <thead><tr><th>Mode</th><th>Kind</th><th>Port</th><th>Runs on</th><th>Runtimes</th><th>Model</th><th /></tr></thead>
        <tbody>
          {modes.map((m) => (
            <tr key={m.id}>
              <td className="font-mono text-xs">{m.name}<div className="text-gray-500 font-sans">{m.label}</div></td>
              <td>{m.kind}</td><td>{m.port ?? '—'}</td>
              <td className="text-xs">{m.availableOn.join(', ')}</td><td className="text-xs">{m.runtimes.join(', ')}</td>
              <td className="font-mono text-xs">{m.defaultModels.default ?? m.defaultModel ?? '—'}</td>
              <td><button className="btn-ghost" onClick={() => setOpen(open === m.name ? null : m.name)}>{open === m.name ? 'Close' : 'Edit'}</button></td>
            </tr>
          ))}
          {modes.length === 0 && <tr><td colSpan={7} className="text-gray-500">No modes yet.</td></tr>}
        </tbody>
      </table>
      {open && <Form key={open} appId={appId} mode={modes.find((m) => m.name === open)} onDone={setMsg} />}
      <details><summary className="text-sm cursor-pointer text-blue-700">Add a mode</summary><Form appId={appId} onDone={setMsg} /></details>
      <Msg m={msg} />
    </div>
  );
}
