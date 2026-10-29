import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './styles.css';
import { AppProvider, useApp } from './lib/context.jsx';
import Icon from './components/Icon.jsx';
import { Loading, Lock } from './components/ui.jsx';
import Shell from './components/Shell.jsx';
import { LinkArea, MyArea } from './pages/employee/EmployeeArea.jsx';
import Dashboard from './pages/hr/Dashboard.jsx';
import { InitiateRelease, ReleaseRecords } from './pages/hr/Releases.jsx';
import { CaseList, CaseRecord, Meetings } from './pages/hr/Cases.jsx';
import { Overview, Reports } from './pages/hr/Analytics.jsx';
import QuestionnaireView from './pages/hr/Questionnaire.jsx';
import { AppSettings, Integrations, Permissions, UsersRoles, WorkflowSettings } from './pages/hr/Admin.jsx';
import { AuditTrail, NotificationCentre } from './pages/hr/Oversight.jsx';

// Hiding a page is a convenience; the server enforces every permission.
function Guard({ perm, children }) {
  const { can } = useApp();
  const list = Array.isArray(perm[0]) ? perm : [perm];
  if (!list.some(([m, o]) => can(m, o))) return <main><Lock>Your role does not have access to this page.</Lock></main>;
  return children;
}

function NoIdentity() {
  const { session, config } = useApp();
  return (
    <main style={{ maxWidth: 640, margin: '60px auto' }}>
      <section className="card stack" style={{ textAlign: 'center' }}>
        <span className="brand-mark" style={{ margin: '0 auto' }}><Icon name="door" size={20} /></span>
        <h1>{config.appName}</h1>
        <p className="muted">{session?.authMode === 'entra'
          ? 'Sign-in with Microsoft Entra ID is required. Single sign-on is not connected in this build yet — see “Microsoft Entra ID authentication” in the README.'
          : 'No user is selected.'}</p>
        <p className="small muted">Employees open their personal exit interview link from the release notification.</p>
      </section>
    </main>
  );
}

function Home() {
  const { session } = useApp();
  const i = session?.identity;
  if (!i) return <NoIdentity />;
  return <Navigate to={i.kind === 'employee' ? '/me' : '/hr'} replace />;
}
function HrOnly({ children }) {
  const { session } = useApp();
  const i = session?.identity;
  if (!i) return <NoIdentity />;
  if (i.kind === 'employee') return <Navigate to="/me" replace />;
  return children;
}
function EmpOnly({ children }) {
  const { session } = useApp();
  const i = session?.identity;
  if (!i) return <NoIdentity />;
  if (i.kind !== 'employee') return <Navigate to="/hr" replace />;
  return children;
}

function Routed() {
  const { config, session } = useApp();
  if (!config || !session) return <main><Loading /></main>;
  const g = (perm, el) => <Guard perm={perm}>{el}</Guard>;
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/exit/:code/*" element={<LinkArea />} />
      <Route element={<Shell />}>
        <Route path="/me/*" element={<EmpOnly><MyArea /></EmpOnly>} />
        <Route path="/hr" element={<HrOnly><Dashboard /></HrOnly>} />
        <Route path="/hr/releases/new" element={<HrOnly>{g(['releases', 'c'], <InitiateRelease />)}</HrOnly>} />
        <Route path="/hr/releases" element={<HrOnly>{g(['releases', 'r'], <ReleaseRecords />)}</HrOnly>} />
        <Route path="/hr/cases" element={<HrOnly>{g(['cases', 'r'], <CaseList />)}</HrOnly>} />
        <Route path="/hr/cases/:id" element={<HrOnly>{g(['cases', 'r'], <CaseRecord />)}</HrOnly>} />
        <Route path="/hr/meetings" element={<HrOnly>{g(['meetings', 'r'], <Meetings />)}</HrOnly>} />
        <Route path="/hr/analytics" element={<HrOnly>{g(['analytics', 'r'], <Overview />)}</HrOnly>} />
        <Route path="/hr/reports" element={<HrOnly>{g(['reports', 'r'], <Reports />)}</HrOnly>} />
        <Route path="/hr/admin/questionnaire" element={<HrOnly>{g(['questionnaire', 'r'], <QuestionnaireView />)}</HrOnly>} />
        <Route path="/hr/admin/users" element={<HrOnly>{g(['users', 'r'], <UsersRoles />)}</HrOnly>} />
        <Route path="/hr/admin/permissions" element={<HrOnly>{g(['users', 'r'], <Permissions />)}</HrOnly>} />
        <Route path="/hr/admin/workflow" element={<HrOnly>{g(['config', 'r'], <WorkflowSettings />)}</HrOnly>} />
        <Route path="/hr/admin/integrations" element={<HrOnly>{g(['integrations', 'r'], <Integrations />)}</HrOnly>} />
        <Route path="/hr/admin/settings" element={<HrOnly>{g(['config', 'r'], <AppSettings />)}</HrOnly>} />
        <Route path="/hr/notifications" element={<HrOnly><NotificationCentre /></HrOnly>} />
        <Route path="/hr/audit" element={<HrOnly>{g(['audit', 'r'], <AuditTrail />)}</HrOnly>} />
        <Route path="/hr/*" element={<HrOnly><main><Lock>Page not found.</Lock></main></HrOnly>} />
      </Route>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider><Routed /></AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
