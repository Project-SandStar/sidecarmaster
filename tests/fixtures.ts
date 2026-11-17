import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/** A small Sound Suite DB with the fleet tables (system.db shape) and Config. */
export function makeSoundSuiteDb(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-')), 'system.db');
  const db = new Database(file);
  db.exec(`
    create table HostProvisioning (id text primary key, sidecarUrl text, hostOsOverride text, masterUrlForHost text, notes text, updatedAt datetime, createdAt datetime, masterWsPortForHost integer);
    create table HostRoleAssignment (id text primary key, sidecarUrl text, mode text, enabled boolean, minOnline integer, idleTimeoutMin integer, modelOverride text, createdAt datetime, updatedAt datetime, runtime text);
    create table SidecarCommand (id text primary key, status text);
    create table Config (key text primary key, value text);
  `);
  db.prepare('insert into HostProvisioning values (?,?,?,?,?,?,?,?)').run('p1', 'http://100.100.192.119:8098', null, 'http://100.100.170.238:3000', 'mcpserver', null, null, 3002);
  db.prepare('insert into HostProvisioning values (?,?,?,?,?,?,?,?)').run('p2', 'http://192.168.20.6:8098', 'windows-docker-wsl2', null, null, null, null, null);
  const ra = db.prepare('insert into HostRoleAssignment values (?,?,?,?,?,?,?,?,?,?)');
  ra.run('r1', 'http://100.100.192.119:8098', 'ss-embedding', 1, 1, 5, null, null, null, 'host');
  ra.run('r2', 'http://192.168.20.6:8098', 'ss-ocr', 1, 0, 10, 'qwen2.5vl:7b', null, null, null);
  ra.run('r3', 'http://192.168.88.242:8098', 'ss-reranker', 0, 0, 5, null, null, null, null);
  db.prepare('insert into SidecarCommand values (?,?)').run('c1', 'pending');
  db.prepare('insert into Config values (?,?)').run('gpu.sidecars', JSON.stringify([
    { url: 'http://100.100.192.119:8098', hostname: 'mcpserver.local', mode: 'websocket', status: 'connected', lastSeen: '2026-10-30T10:00:00Z', containers: [{ name: 'a' }, { name: 'b' }] },
    { url: 'http://192.168.20.6:8098', hostname: 'GPUWS34', mode: 'websocket', status: 'connected', containers: [] },
    { url: 'http://192.168.88.242:8098', hostname: 'gpuws34', status: 'offline' },
  ]));
  db.close();
  return file;
}
