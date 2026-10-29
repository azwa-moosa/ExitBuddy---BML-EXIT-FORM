// ============================================================================
// SQLite database (sql.js — real SQLite compiled to WebAssembly, so installing
// never needs Xcode or a C++ toolchain). The database is one .sqlite file.
// Schema changes are applied by numbered migrations (src/migrations) and
// recorded in the schema_migrations table, so an existing v3 database is
// upgraded in place rather than recreated.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { MIGRATIONS } from './migrations/index.js';

const require = createRequire(import.meta.url);
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dbFile = () => path.resolve(SERVER_DIR, process.env.DB_FILE || './data/exit.sqlite');

let SQL = null;
let db = null;
let depth = 0;

export async function openDb({ fresh = false } = {}) {
  if (!SQL) SQL = await initSqlJs({ locateFile: f => require.resolve(`sql.js/dist/${f}`) });
  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = (!fresh && fs.existsSync(file)) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  db.run('PRAGMA foreign_keys = ON;');
  const applied = migrate();
  save();
  return { applied };
}

export function closeDb() { if (db) { db.close(); db = null; } }

function migrate() {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const done = new Set(all('SELECT id FROM schema_migrations').map(r => r.id));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.run('BEGIN');
    try {
      m.up({ exec: sql => db.run(sql), all, get, run, columns });
      run('INSERT INTO schema_migrations (id) VALUES (?)', [m.id]);
      db.run('COMMIT');
      applied.push(m.id);
    } catch (e) { db.run('ROLLBACK'); throw new Error(`Migration ${m.id} failed: ${e.message}`); }
  }
  return applied;
}

export const columns = table => all(`PRAGMA table_info(${table})`).map(c => c.name);

export function save() {
  if (!db) return;
  const file = dbFile();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  fs.renameSync(tmp, file);
}

export function all(sql, params = []) {
  const st = db.prepare(sql);
  try {
    st.bind(params.map(v => v === undefined ? null : v));
    const rows = [];
    while (st.step()) rows.push(st.getAsObject());
    return rows;
  } finally { st.free(); }
}
export const get = (sql, params = []) => all(sql, params)[0];
export function run(sql, params = []) {
  db.run(sql, params.map(v => v === undefined ? null : v));
  const id = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0];
  return { id, changes: db.getRowsModified() };
}

// Run fn in one transaction (nested calls join the outer one) and save once.
export function tx(fn) {
  if (depth > 0) { depth++; try { return fn(); } finally { depth--; } }
  depth = 1;
  db.run('BEGIN');
  try { const out = fn(); db.run('COMMIT'); depth = 0; save(); return out; }
  catch (e) { depth = 0; try { db.run('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
}

// ---- settings (JSON values) ----
export function getSettings() {
  const out = {};
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = JSON.parse(r.value);
  return out;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}

// ---- reference numbers: EX/2026/0001 — sequential per year, never reused ----
export function nextRef(prefix = 'EX', year = new Date().getFullYear()) {
  const row = get('SELECT value FROM sequences WHERE prefix = ? AND year = ?', [prefix, year]);
  const value = (row ? row.value : 0) + 1;
  run('INSERT INTO sequences(prefix, year, value) VALUES(?,?,?) ON CONFLICT(prefix, year) DO UPDATE SET value = excluded.value', [prefix, year, value]);
  return `${prefix}/${year}/${String(value).padStart(4, '0')}`;
}

// ---- timestamps: stored as UTC "YYYY-MM-DD HH:MM:SS", shown in Maldives time ----
export const utcNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// ---- audit (append-only; UPDATE/DELETE are blocked by triggers) ----
export function audit(actor, module, action, ref, detail, at = null) {
  run(`INSERT INTO audit_log(at, user_name, user_email, role, module, action, ref, detail, actor_id, simulated)
       VALUES (COALESCE(?, datetime('now')),?,?,?,?,?,?,?,?,?)`,
    [at, actor?.name || 'System', actor?.email || null, actor?.role || null, module, action, ref || null, detail || null,
      actor?.actorId || null, actor?.simulated ? 1 : 0]);
}
