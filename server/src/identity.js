// ============================================================================
// Identity and authorization.
//
// LOCAL DEVELOPMENT (AUTH_MODE=dev, NODE_ENV not "production")
//   No login. The header's user switcher stores the chosen identity in a
//   cookie: a predefined HR user, a demo persona, or a demo employee.
//   Every action is still checked against that identity's ROLE PERMISSIONS on
//   the server, and is recorded as "simulated" in the audit trail.
//
// PRODUCTION
//   Dev identities are refused. The server will not start with AUTH_MODE=dev
//   and NODE_ENV=production. AUTH_MODE=entra expects Microsoft Entra ID tokens
//   (see README → Authentication). Token validation is NOT implemented yet, so
//   production mode answers 401 until it is — there is no bypass.
// ============================================================================
import { get } from './db.js';

export const COOKIE = 'exit_dev_identity';
export const authMode = () => (process.env.AUTH_MODE || 'dev').toLowerCase();
export const isProduction = () => process.env.NODE_ENV === 'production';
export const devMode = () => authMode() === 'dev' && !isProduction();

export function assertSafeConfig() {
  if (isProduction() && authMode() === 'dev') {
    throw new Error('Refusing to start: AUTH_MODE=dev (no login) is not allowed when NODE_ENV=production.');
  }
}

export function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0])
    .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

export function loadUser(id) {
  const u = get(`SELECT u.id, u.name, u.email, u.title, u.active, u.persona, u.employee_id, r.id AS role_id, r.name AS role, r.dashboard, r.permissions
                 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`, [id]);
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, title: u.title, persona: !!u.persona, roleId: u.role_id, role: u.role,
    dashboard: u.dashboard, permissions: JSON.parse(u.permissions || '{}') };
}

export function loadEmployee(employeeId) {
  const e = get('SELECT * FROM employees WHERE employee_id = ?', [employeeId]);
  return e ? { employeeId: e.employee_id, name: e.name, division: e.division, jobTitle: e.job_title } : null;
}

function defaultUserId() {
  const r = get(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE u.active = 1 ORDER BY r.system DESC, r.sort, u.id LIMIT 1`);
  return r?.id;
}

// Resolve who is calling. Returns { kind: 'user'|'employee', ... } or null.
export function identify(req) {
  if (!devMode()) return null;               // production identity: Entra ID (not configured yet)
  const raw = parseCookies(req)[COOKIE] || '';
  if (raw.startsWith('e:')) {
    const emp = loadEmployee(raw.slice(2));
    if (emp) return { kind: 'employee', employee: emp, simulated: true };
  }
  const id = raw.startsWith('u:') ? Number(raw.slice(2)) : defaultUserId();
  const user = loadUser(id) || loadUser(defaultUserId());
  return user ? { kind: 'user', user, simulated: true } : null;
}

export const can = (user, module, op) => !!(user && user.permissions?.[module]?.[op]);

// Actor description used for audit, workflow history and digital records.
export function actorOf(req) {
  const idn = req.identity;
  if (!idn) return { name: 'System', role: 'System', type: 'system' };
  if (idn.kind === 'employee') return { type: 'employee', name: idn.employee.name, role: 'Employee', actorId: idn.employee.employeeId, simulated: idn.simulated };
  return { type: 'user', name: idn.user.name, email: idn.user.email, role: idn.user.role, actorId: `U${String(idn.user.id).padStart(3, '0')}`, userId: idn.user.id, simulated: idn.simulated };
}

export function attachIdentity(req, res, next) { req.identity = identify(req); next(); }

export function requireIdentity(req, res, next) {
  if (req.identity) return next();
  res.status(401).json({ error: devMode() ? 'No identity selected' : 'Sign-in required. Production authentication (Microsoft Entra ID) is not configured yet — see README.' });
}
export function requireUser(req, res, next) {
  if (req.identity?.kind === 'user') { req.user = req.identity.user; return next(); }
  res.status(req.identity ? 403 : 401).json({ error: 'This area is for People & Culture staff.' });
}
export function requireEmployee(req, res, next) {
  if (req.identity?.kind === 'employee') return next();
  res.status(403).json({ error: 'Switch to an employee to see this.' });
}

// Route guard: identity must hold permission `op` on `module`.
export const allow = (module, op) => (req, res, next) => {
  if (can(req.user, module, op)) return next();
  res.status(403).json({ error: 'Your role does not allow this.', module, op });
};
export const allowAny = (...pairs) => (req, res, next) => {
  if (pairs.some(([m, o]) => can(req.user, m, o))) return next();
  res.status(403).json({ error: 'Your role does not allow this.' });
};
