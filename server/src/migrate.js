// npm run migrate — applies any pending database migrations and adds missing
// reference data (settings, questionnaires, notification rules). Existing
// records are kept. Use this to upgrade a v3 exit.sqlite in place.
import './env.js';
import { openDb, tx, dbFile } from './db.js';
import { ensureReferenceData } from './bootstrap.js';

const { applied } = await openDb();
tx(() => ensureReferenceData());
console.log(applied.length ? `  Applied: ${applied.join(', ')} → ${dbFile()}` : `  Up to date: ${dbFile()}`);
