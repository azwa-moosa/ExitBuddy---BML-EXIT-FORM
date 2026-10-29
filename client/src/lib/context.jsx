import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { setTimeZone } from './format.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

function applyTheme(t) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function AppProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [session, setSession] = useState(undefined);
  const [toastMsg, setToast] = useState(null);
  const [confirmState, setConfirm] = useState(null);
  const [theme, setThemeState] = useState(() => { try { return localStorage.getItem('exit-theme') || 'system'; } catch { return 'system'; } });
  const timer = useRef();

  const loadConfig = useCallback(async () => {
    const c = await api('/config');
    setConfig(c); setTimeZone(c.timezone);
    document.documentElement.setAttribute('data-brand', c.brandTheme || 'teal');
    document.title = c.appName;
  }, []);
  const loadSession = useCallback(async () => {
    try { setSession(await api('/session')); } catch { setSession(null); }
  }, []);
  useEffect(() => { loadConfig(); loadSession(); }, [loadConfig, loadSession]);
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem('exit-theme', theme); } catch { /* ignore */ }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => theme === 'system' && applyTheme('system');
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, [theme]);

  const toast = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind }); clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3400);
  }, []);
  // confirm({ title, body, confirmLabel, danger, input: { label, required } }) → Promise<false | true | string>
  const confirm = useCallback(opts => new Promise(resolve => setConfirm({ ...opts, resolve })), []);

  const user = session?.identity?.kind === 'user' ? session.identity.user : null;
  const can = useCallback((m, o) => !!user?.permissions?.[m]?.[o], [user]);
  const value = useMemo(() => ({ config, loadConfig, session, loadSession, user, can, toast, confirm, theme, setTheme: setThemeState }),
    [config, loadConfig, session, loadSession, user, can, toast, confirm, theme]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && <div className={`toast ${toastMsg.kind === 'error' ? 'error' : ''}`} role="status">{toastMsg.msg}</div>}
      {confirmState && <ConfirmDialog {...confirmState} onDone={v => { confirmState.resolve(v); setConfirm(null); }} />}
    </Ctx.Provider>
  );
}

function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger, input, onDone }) {
  const [text, setText] = useState('');
  const ok = !input?.required || text.trim();
  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onDone(false); }}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2></div>
        <div className="modal-body">
          {typeof body === 'string' ? <p>{body}</p> : body}
          {input && <label className="field">{input.label}{input.multiline ? <textarea autoFocus value={text} onChange={e => setText(e.target.value)} /> : <input type="text" autoFocus value={text} onChange={e => setText(e.target.value)} />}</label>}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => onDone(false)}>Cancel</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} disabled={!ok} onClick={() => onDone(input ? text.trim() : true)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
