// Session and public configuration.
import { Router } from 'express';
import { getSettings } from '../db.js';
import { devMode, authMode } from '../identity.js';
import { MODULES, EXIT_TYPES } from '../config/defaults.js';
import { ABOUT_FIELDS, CONTACT_FIELDS, RATING_LABELS } from '../config/questionnaires.js';
import { STATUSES, STATUS_LABEL } from '../services/workflow.js';

export function publicConfig() {
  const s = getSettings();
  return {
    appName: s.appName, companyName: s.companyName, orgName: s.orgName, brandTheme: s.brandTheme, timezone: s.timezone || 'Indian/Maldives',
    divisions: s.divisions, minResponses: s.minResponses, suppressBelow: s.suppressBelow,
    aboutFields: ABOUT_FIELDS, contactFields: CONTACT_FIELDS, ratingLabels: RATING_LABELS, exitTypes: EXIT_TYPES, statuses: STATUSES, statusLabels: STATUS_LABEL,
    workflow: { acknowledgementSource: s.workflow?.acknowledgementSource, requireAcknowledgement: s.workflow?.requireAcknowledgement },
    devMode: devMode(), authMode: authMode(),
  };
}

export const sessionRouter = Router();
sessionRouter.get('/config', (req, res) => res.json(publicConfig()));
sessionRouter.get('/session', (req, res) => {
  const i = req.identity;
  res.json({
    devMode: devMode(), authMode: authMode(), modules: MODULES,
    identity: !i ? null : i.kind === 'employee' ? { kind: 'employee', employee: i.employee, simulated: i.simulated }
      : { kind: 'user', user: i.user, simulated: i.simulated },
  });
});
