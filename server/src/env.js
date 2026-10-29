// Loads .env from the project root (or server/), before any other module reads process.env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const p of [path.resolve(here, '../../.env'), path.resolve(here, '../.env')]) {
  if (fs.existsSync(p)) dotenv.config({ path: p, override: false, quiet: true });
}
