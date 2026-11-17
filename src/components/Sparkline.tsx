/** Small SVG line chart (no chart library). Values may be null (gap). */
export function Sparkline({ values, max, label, unit = '' }: { values: (number | null)[]; max?: number; label: string; unit?: string }) {
  const w = 320, h = 60;
  const nums = values.filter((v): v is number => v !== null);
  const top = max ?? Math.max(1, ...nums);
  const pts = values.map((v, i) => (v === null ? null : `${(i / Math.max(1, values.length - 1)) * w},${h - (v / top) * h}`));
  const segs: string[][] = [[]];
  for (const p of pts) { if (p) segs[segs.length - 1].push(p); else if (segs[segs.length - 1].length) segs.push([]); }
  const last = nums.length ? nums[nums.length - 1] : null;
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}: <span className="font-medium text-gray-800">{last === null ? '—' : `${Math.round(last * 10) / 10}${unit}`}</span></div>
      <svg width={w} height={h} className="bg-gray-50 rounded" role="img" aria-label={label}>
        {segs.filter((s) => s.length).map((s, i) => <polyline key={i} fill="none" stroke="#2563eb" strokeWidth={1.5} points={s.join(' ')} />)}
      </svg>
    </div>
  );
}
