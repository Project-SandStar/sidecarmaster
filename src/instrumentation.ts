/** Server start: make the first admin from env, then re-import Sound Suite (read-only) on a timer. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { ensureFirstAdmin } = await import('./lib/auth');
  const { importSoundSuite, sourceFromEnv } = await import('./lib/importer/run');
  try {
    const r = await ensureFirstAdmin();
    if (r === 'missing-env') console.warn('[sidecarmaster] no admin yet: set SM_ADMIN_USERNAME and SM_ADMIN_PASSWORD');
    if (r === 'created') console.log('[sidecarmaster] first admin created from env');
  } catch (e) { console.error('[sidecarmaster] admin bootstrap failed:', e instanceof Error ? e.message : e); }

  // Sidecar relay (task 2.2): ws://<host>:SM_RELAY_PORT/sidecar, same port/path as Sound Suite.
  if (process.env.SM_RELAY_ENABLED !== '0') {
    try {
      const { startRelay } = await import('./lib/relay/server');
      const { persistSeen } = await import('./lib/relay/persist');
      const { cleanupCommands } = await import('./lib/relay/command-queue');
      const port = Number(process.env.SM_RELAY_PORT ?? '3002');
      const relay = startRelay({
        port,
        host: process.env.SM_RELAY_HOST || undefined,
        token: process.env.SM_SIDECAR_TOKEN || null,
        publicUrl: process.env.SM_PUBLIC_URL || null,
        onSeen: (s, kind) => persistSeen(s, kind),
      });
      // Phase 3/5 read the fleet and send commands through the relay.
      const { relayFleetStatus, relayFleetControl, relayCommandSender } = await import('./lib/fleet/relay-adapter');
      const { setFleetStatus, setFleetControl, setCommandSender } = await import('./lib/fleet/interfaces');
      setFleetStatus(relayFleetStatus());
      setCommandSender(relayCommandSender());
      setFleetControl(relayFleetControl());
      relay.wss.on('listening', () => console.log(`[sidecarmaster] sidecar relay listening on :${relay.port()}/sidecar`));
      setInterval(() => { cleanupCommands().catch(() => {}); }, 60_000).unref();
    } catch (e) { console.error('[sidecarmaster] sidecar relay failed to start:', e instanceof Error ? e.message : e); }
  }

  // Docker sidecar releases from the public GitHub mirror (Releases > GitHub; on by default).
  try { (await import('./lib/github-releases')).startGithubSync(); }
  catch (e) { console.error('[sidecarmaster] GitHub sync start failed:', e instanceof Error ? e.message : e); }

  try {
    const { startMonitor } = await import('./lib/monitor/loop');
    startMonitor();
  } catch (e) { console.error('[sidecarmaster] monitor start failed:', e instanceof Error ? e.message : e); }

  // Phase 3 control: seed the app registry, then run the reconcile loop (it idles until the relay registers a CommandSender).
  try {
    const { seedRegistry } = await import('./lib/control/registry');
    const r = await seedRegistry();
    const { setAppRegistry } = await import('./lib/apps/interfaces');
    const { controlAppRegistry } = await import('./lib/apps/registry-adapter');
    setAppRegistry(controlAppRegistry());
    if (r.apps || r.modes) console.log(`[sidecarmaster] registry seeded: ${r.apps} apps, ${r.modes} modes`);
    // The loop always ticks; each tick reads the switch (Settings → Reconcile, SM_RECONCILE=0 locks it off).
    (await import('./lib/control/reconcile')).startReconcileLoop();
    const sw = await (await import('./lib/control/reconcile-switch')).reconcileSwitch();
    console.log(`[sidecarmaster] reconcile loop started; reconcile is ${sw.on ? 'on' : `off (${sw.reason})`}`);
  } catch (e) { console.error('[sidecarmaster] control start failed:', e instanceof Error ? e.message : e); }

  const src = sourceFromEnv();
  const min = Number(process.env.SM_IMPORT_INTERVAL_MIN ?? '5');
  if (!src || !(min > 0)) return;
  const tick = async () => {
    try {
      const r = await importSoundSuite(src, false);
      console.log(`[sidecarmaster] soundsuite import: hosts +${r.hosts.created}/~${r.hosts.updated}, roles +${r.roles.created}/~${r.roles.updated}, warnings ${r.warnings.length}`);
    } catch (e) { console.error('[sidecarmaster] soundsuite import failed:', e instanceof Error ? e.message : e); }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, min * 60_000).unref();
}
