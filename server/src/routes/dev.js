// Local development identity switching (no login). Refused outside dev mode.
import { Router } from 'express';
import { all } from '../db.js';
import { COOKIE, devMode, loadUser, loadEmployee } from '../identity.js';
import { h, bad } from './util.js';

export const devRouter = Router();
devRouter.use((req, res, next) => devMode() ? next() : bad(res, 'Development identities are disabled in this environment.', 403));

devRouter.get('/identities', (req, res) => {
  const users = all(`SELECT u.id, u.name, u.title, u.persona, r.name AS role, r.dashboard, r.permissions, r.system FROM users u JOIN roles r ON r.id = u.role_id
                     WHERE u.active = 1 ORDER BY u.persona, r.sort, u.name`)
    // viewOnly: the role cannot create, edit or delete anything (e.g. ER Head, Director).
    .map(({ permissions, system, ...u }) => ({ ...u, viewOnly: !system && !Object.values(JSON.parse(permissions || '{}')).some(o => o.c || o.u || o.d) }));
  const employees = all(`SELECT e.employee_id, e.name, e.division, x.ref, x.status FROM exit_interviews x JOIN employees e ON e.employee_id = x.employee_uid
                         WHERE x.withdrawn_at IS NULL ORDER BY CASE WHEN x.status IN ('Closed','No response') THEN 1 ELSE 0 END, x.released_at DESC LIMIT 60`);
  res.json({ users, employees });
});

devRouter.post('/switch', h((req, res) => {
  const { kind, id } = req.body || {};
  let value = null;
  if (kind === 'user' && loadUser(Number(id))) value = `u:${Number(id)}`;
  if (kind === 'employee' && loadEmployee(String(id))) value = `e:${String(id)}`;
  if (!value) return bad(res, 'Unknown identity', 404);
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; HttpOnly; Max-Age=${30 * 86400}`);
  res.json({ ok: true });
}));
