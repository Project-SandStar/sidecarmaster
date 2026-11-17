import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { RoleGrid } from '@/components/control/RoleGrid';
import { roleGridData } from '@/lib/control/pages';
import { listApps } from '@/lib/control/registry';
import { reconcileSwitch } from '@/lib/control/reconcile-switch';

export const dynamic = 'force-dynamic';

/** Sound Suite admin-dashboard.tsx HELP.roleassign, with the "Runtime columns" cards. */
const HELP = [
  'Click a runtime cell to turn a mode on with that runtime; Off turns it off',
  'Unavailable cells are greyed out with a tooltip explaining why',
  'Click the gear on an enabled row to override model / min online / idle timeout',
  'Reset to defaults restores per-OS sensible assignments for a host',
  'Port column shows the port the role binds on the sidecar; ✱ marks a port shared by every role on that runtime',
  'The OS badge shows the OS the sidecar reports; a manual override from Host provisioning is used only when the sidecar reports none',
];

const RUNTIME_CARDS = [
  { label: 'Ollama (native)', engine: 'Ollama (llama.cpp) · GGUF', where: 'Native process on host (Metal/CUDA direct)', macGpu: true, uses: 'embedding, completion, ocr' },
  { label: 'Docker Ollama', engine: 'Ollama (llama.cpp) · GGUF', where: 'Inside a sidecar-managed container', macGpu: false, uses: 'embedding, completion, ocr — Linux/Win only with usable speed' },
  { label: 'Docker vLLM', engine: 'vLLM (PyTorch + CUDA) · HF safetensors', where: 'vllm/vllm-openai container, NVIDIA passthrough', macGpu: false, uses: 'reranker (cross-encoder), rlm' },
  {
    label: 'Docker Model Runner', engine: 'vLLM (Metal on Mac / CUDA on Linux) · MLX format on Mac, HF safetensors on Linux',
    where: 'On host via DMR scheduler (lazy load, no public unload)', macGpu: true,
    uses: 'Reranker excluded on Mac (vllm-metal lacks cross-encoder). RLM excluded on Mac until an MLX conversion of mit-oasys/rlm-qwen3-8b-v0.1 is published',
  },
];

export default async function RoleAssignPage({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  const { app } = await searchParams;
  const [hosts, apps] = await Promise.all([roleGridData(app), listApps()]);
  const sw = await reconcileSwitch();
  const off = !sw.on;
  return (
    <Shell title="Role assignments">
      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex gap-3 text-sm">
            <Link href="/roleassign" className={!app ? 'font-semibold' : 'text-blue-700'}>All apps</Link>
            {apps.filter((a) => a.modeCount > 0).map((a) => (
              <Link key={a.id} href={`/roleassign?app=${a.id}`} className={app === a.id ? 'font-semibold' : 'text-blue-700'}>{a.displayName}</Link>
            ))}
          </div>
          {off ? (
            <p className="text-sm text-amber-700" data-banner="reconcile-off">
              Reconcile is off ({sw.reason}): changes only save here. Nothing is pushed to sidecars; &quot;Sync now&quot; and &quot;Reset to defaults&quot; only save too.{' '}
              <Link href="/settings?tab=reconcile" className="text-blue-700 underline whitespace-nowrap">Reconcile settings →</Link>
            </p>
          ) : (
            <p className="text-sm text-gray-600">Changes save at once and reach the sidecar on the next config push (reconcile, every 30 s).</p>
          )}
          <RoleGrid hosts={hosts} app={app ?? null} reconcileOff={off} />
          <p className="text-xs text-gray-500">Every change is written to the <Link href="/audit" className="text-blue-700">audit log</Link>.</p>
        </div>
        <aside className="hidden lg:block flex-shrink-0 w-64 bg-gray-50 border border-gray-200 rounded-lg p-5 space-y-3">
          <h3 className="text-sm font-semibold text-gray-900">Role Assignments</h3>
          <p className="text-xs text-gray-600">Pick which modes each sidecar should run. Per-host model and runtime overrides.</p>
          <ul className="list-disc pl-4 space-y-1 text-[11px] text-gray-600">{HELP.map((t) => <li key={t}>{t}</li>)}</ul>
          <div className="border-t border-gray-200 pt-3 space-y-3">
            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Runtime columns</h4>
            <p className="text-[11px] text-gray-500 leading-relaxed">A cell is clickable only when the runtime supports the role on that host&apos;s OS.</p>
            {RUNTIME_CARDS.map((r) => (
              <div key={r.label} className="border border-gray-200 rounded-md p-2 bg-white">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="font-mono text-[11px] font-semibold text-gray-800">{r.label}</div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.macGpu ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{r.macGpu ? 'Mac GPU ✓' : 'Mac GPU ✗'}</span>
                </div>
                <div className="text-[11px] text-gray-600 leading-snug"><span className="text-gray-400">Engine:</span> {r.engine}</div>
                <div className="text-[11px] text-gray-600 leading-snug"><span className="text-gray-400">Where:</span> {r.where}</div>
                <div className="text-[11px] text-gray-600 leading-snug"><span className="text-gray-400">Used by:</span> {r.uses}</div>
              </div>
            ))}
            <div className="border border-gray-200 rounded-md p-2 bg-gray-50">
              <div className="text-[11px] font-semibold text-gray-700 mb-1">Engine in one line</div>
              <div className="text-[11px] text-gray-600 leading-snug">Ollama = small quantized GGUFs you stream tokens from. vLLM = batched safetensors with rerank / recursive-call serving.</div>
            </div>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
