// Builds the Express app (used by index.js and by the automated tests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { attachIdentity, requireIdentity, requireUser, devMode, can } from './identity.js';
import { sessionRouter } from './routes/session.js';
import { devRouter } from './routes/dev.js';
import { meRouter, linkRouter } from './routes/employee.js';
import { releasesRouter } from './routes/releases.js';
import { casesRouter } from './routes/cases.js';
import { insightsRouter } from './routes/insights.js';
import { adminRouter, processInbound } from './routes/admin.js';
import { h, bad } from './routes/util.js';
import { audit } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function buildApp({ onReset } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '1mb' }));

  // CORS for a separately hosted frontend (e.g. Vercel). Off unless configured.
  const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    const o = req.headers.origin;
    if (o && origins.includes(o)) {
      res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Inbound OneUI / MiHCM events. Requires INTEGRATION_SHARED_SECRET (header X-Integration-Key).
  app.post('/api/integrations/inbound/:system', h((req, res) => {
    const secret = process.env.INTEGRATION_SHARED_SECRET;
    if (!secret) return bad(res, 'Inbound integration is disabled (INTEGRATION_SHARED_SECRET not set).', 503);
    if (req.headers['x-integration-key'] !== secret) return bad(res, 'Invalid integration key.', 401);
    const system = req.params.system.toLowerCase() === 'oneui' ? 'OneUI' : req.params.system.toLowerCase() === 'mihcm' ? 'MiHCM' : null;
    if (!system) return bad(res, 'Unknown system', 404);
    const out = processInbound(system, req.body || {});
    res.status(out.status).json(out);
  }));

  app.use('/api', attachIdentity);
  app.use('/api', sessionRouter);
  app.use('/api/dev', devRouter);
  app.use('/api/public/exit', linkRouter);
  app.use('/api/me', requireIdentity, meRouter);

  // Demo reset (local development only, needs configuration Edit permission).
  app.post('/api/dev/reset', requireIdentity, requireUser, async (req, res, next) => {
    if (!devMode()) return bad(res, 'Not available.', 403);
    if (!can(req.user, 'config', 'u')) return bad(res, 'Your role cannot reset demo data.', 403);
    try { await onReset?.(); res.json({ ok: true }); } catch (e) { next(e); }
  });

  app.use('/api', requireIdentity, requireUser, releasesRouter, casesRouter, insightsRouter, adminRouter);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server.' }); });

  const dist = path.resolve(here, '../../client/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return app;
}
export { audit };
