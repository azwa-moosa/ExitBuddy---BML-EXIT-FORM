// Fetch wrapper for the Express API.
// VITE_API_BASE lets the frontend run on a different host (e.g. Vercel);
// leave it empty when the API serves the app (local dev and `npm start`).
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');
export const apiUrl = path => `${BASE}/api${path}`;

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(apiUrl(path), {
    method, credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data);
  return data;
}

export const qs = obj => {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) p.set(k, v === true ? '1' : v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};

// Absolute employee link for copying (works in a new tab / browser).
export const employeeLink = rel => `${window.location.origin}${rel}`;
