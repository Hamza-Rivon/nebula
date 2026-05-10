// Persisted key/value app settings. Tiny because we only have a couple of
// knobs to remember across restarts. JSON-encoded values keep the schema
// open: the next setting we add doesn't need a migration.
//
// Today: `auto_drain` (boolean) — whether the analyze queue auto-processes
// freshly enqueued session tasks. Default true so a fresh container "just
// works" — every captured live request is analyzed in the background. The
// manager flips it off when they want to triage manually.

import { db } from "./db.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

const getStmt = db.prepare(`SELECT json FROM app_settings WHERE key = ?`);
const upsertStmt = db.prepare(
  `INSERT INTO app_settings (key, json, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET
     json = excluded.json,
     updated_at = excluded.updated_at`,
);

export function getSetting<T>(key: string, fallback: T): T {
  const row = getStmt.get(key) as { json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.json) as T;
  } catch {
    return fallback;
  }
}

export function setSetting<T>(key: string, value: T): void {
  upsertStmt.run(key, JSON.stringify(value), Date.now());
}

const AUTO_DRAIN_KEY = "auto_drain";

export function getAutoDrain(): boolean {
  return getSetting<boolean>(AUTO_DRAIN_KEY, true);
}

export function setAutoDrain(value: boolean): void {
  setSetting(AUTO_DRAIN_KEY, !!value);
}
