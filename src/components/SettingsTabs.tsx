'use client';
import { useState } from 'react';
import { NetbirdPanel } from './NetbirdPanel';
import { AlertsPanel } from './AlertsPanel';
import { ReconcilePanel } from './ReconcilePanel';

const TABS = [{ id: 'netbird', label: 'NetBird' }, { id: 'alerts', label: 'Alerts' }, { id: 'reconcile', label: 'Reconcile' }] as const;
type TabId = (typeof TABS)[number]['id'];

export function SettingsTabs({ initial }: { initial?: string }) {
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initial) ? (initial as TabId) : 'netbird');
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === t.id ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-600'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'netbird' ? <NetbirdPanel /> : tab === 'alerts' ? <AlertsPanel /> : <ReconcilePanel />}
    </div>
  );
}
