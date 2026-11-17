'use client';
/** A button that POSTs/PATCHes/DELETEs JSON and reloads the page; shows the error inline. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ActionButton({ url, body, method = 'POST', label, confirm: ask, className = 'btn-ghost', disabled = false, title }:
  { url: string; body?: unknown; method?: string; label: string; confirm?: string; className?: string; disabled?: boolean; title?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (ask && !window.confirm(ask)) return;
    setBusy(true); setErr(null);
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { const j = (await r.json().catch(() => ({}))) as { error?: string; message?: string }; setErr(j.error ?? j.message ?? `Error ${r.status}`); return; }
    router.refresh();
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={`${className} !px-2 !py-1 text-xs`} disabled={busy || disabled} title={title} onClick={go}>{busy ? '…' : label}</button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}
