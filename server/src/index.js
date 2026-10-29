// ============================================================================
// ExitBuddy — Exit Interview & Staff Release API server.
//   npm run dev   → API on :4000 + React app on :5173
//   npm start     → serves the built React app and the API on :4000
// ============================================================================
import './env.js';
import { openDb } from './db.js';
import { assertSafeConfig, devMode, authMode } from './identity.js';
import { ensureReferenceData } from './bootstrap.js';
import { buildApp } from './app.js';
import { seedDatabase } from './seed.js';
import { sweep } from './services/workflow.js';
import { get, tx } from './db.js';

assertSafeConfig();
const { applied } = await openDb();
if (applied.length) console.log(`  Database migrations applied: ${applied.join(', ')}`);
if (!get('SELECT 1 FROM roles LIMIT 1')) { console.log('  Empty database — loading demo data (npm run seed)…'); await seedDatabase({ quiet: true }); }
tx(() => ensureReferenceData());

const app = buildApp({ onReset: () => seedDatabase({ quiet: true }) });
setInterval(() => { try { tx(() => sweep()); } catch (e) { console.error(e); } }, 6 * 3600e3).unref();

const PORT = Number(process.env.PORT) || 4000;
app.listen(PORT, () => {
  console.log(`\n  Exit Interview & Staff Release API → http://localhost:${PORT}`);
  console.log(`  Auth mode: ${authMode()}${devMode() ? ' — LOCAL DEVELOPMENT: no login, user switcher enabled, actions marked simulated' : ''}\n`);
});
