// Dates: the server stores UTC "YYYY-MM-DD HH:MM:SS"; we show Maldives time
// (Settings → time zone). Plain dates (YYYY-MM-DD) are shown as they are.
let TZ = 'Indian/Maldives';
export const setTimeZone = tz => { TZ = tz || 'Indian/Maldives'; };
export const tzLabel = () => (TZ === 'Indian/Maldives' ? 'MVT' : TZ);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isPlainDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const parseUtc = s => { const d = new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? '' : 'Z')); return isNaN(d) ? null : d; };
const parts = d => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
  .formatToParts(d).map(p => [p.type, p.value]));

export function fmtDate(s) {
  if (!s) return '—';
  if (isPlainDate(s)) { const [y, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; }
  const d = parseUtc(s); if (!d) return String(s);
  const p = parts(d); return `${+p.day} ${MONTHS[+p.month - 1]} ${p.year}`;
}
export function fmtTime(s) { const d = parseUtc(s); if (!d) return ''; const p = parts(d); return `${p.hour === '24' ? '00' : p.hour}:${p.minute}`; }
export function fmtDateTime(s, withZone = true) {
  if (!s) return '—';
  if (isPlainDate(s)) return fmtDate(s);
  return `${fmtDate(s)}, ${fmtTime(s)}${withZone ? ` ${tzLabel()}` : ''}`;
}
export const monthLabel = m => MONTHS[+String(m).slice(5, 7) - 1] || m;
export const monthYear = m => `${monthLabel(m)} ${String(m).slice(0, 4)}`;
export const today = () => { const p = parts(new Date()); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const initials = n => String(n || '?').replace(/\(.*\)/, '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
// Colour for a 1–5 rating (display only: below 3 red, 3 to under 4 amber, 4+ green).
export const ratingClass = v => v == null || typeof v !== 'number' ? 'none' : v < 3 ? 'red' : v < 4 ? 'amber' : 'green';
export const fillCompany = (t, c) => String(t || '').replaceAll('{company}', c || 'Company');
export const STATUS_TONE = {
  Released: 'sky', Acknowledged: 'violet', 'Form in progress': 'violet', Submitted: 'amber', 'Meeting scheduled': 'brand',
  Interviewed: 'green', Closed: '', 'No response': 'red', Withdrawn: 'red',
};
