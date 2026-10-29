// ============================================================================
// QUESTIONNAIRE — the original ExitBuddy exit interview (Q1–Q9), unchanged.
//
// This is the only questionnaire used for new releases. Wording, answer
// choices, required flags and order are the original ExitBuddy configuration
// and are not edited in the app.
//
// It is stored in the `questionnaires` table as version 1. Records always keep
// the version they answered, so any older answers in an upgraded database
// stay readable (migration 003 retires every other version).
//
// Analytics never read raw question codes. Each question carries a `metric`
// (and options carry a `category`, `score` or flags):
//   reasons · reason_other · overall · factor · return_refer
//   text_stay · text_other · text_growth
// ============================================================================

// Reason categories used in analytics (ExitBuddy reasons map onto these).
export const REASON_CATEGORIES = [
  'Career progression', 'Pay and benefits', 'Line manager relationship', 'Workload and work–life balance',
  'Flexibility and working arrangements', 'Learning and development', 'Recognition', 'Organisational direction and change',
  'Job content and fit', 'Team and working environment', 'Career change', 'Further study', 'Relocation',
  'Personal or family reasons', 'Retirement', 'End of contract', 'Other',
];

// Factors rated by leavers (experience factors chart).
export const FACTORS = [
  'Role and responsibilities', 'Line manager relationship', 'Manager support for development', 'Career progression and growth',
  'Pay and benefits', 'Workload and work–life balance', 'Team and colleagues', 'Recognition', 'Training and learning',
  'Work environment', 'Tools and resources',
];

const o = (value, extra = {}) => ({ value, label: extra.label || value, ...extra });

export const EXITBUDDY = {
  version: 1,
  name: 'ExitBuddy exit interview',
  note: 'Original ExitBuddy exit interview questions (Q1–Q9).',
  questions: [
    { code: 'q1', type: 'multi', required: true, metric: 'reasons', text: 'Why are you leaving? (select all that apply)',
      options: [
        o('Career advancement', { category: 'Career progression' }), o('Higher pay', { category: 'Pay and benefits' }),
        o('Better benefits', { category: 'Pay and benefits' }), o('Work-life balance', { category: 'Workload and work–life balance' }),
        o('Career change', { category: 'Career change' }), o('Manager relationship', { category: 'Line manager relationship' }),
        o('Personal/family', { category: 'Personal or family reasons' }), o('Other', { category: 'Other' }),
      ] },
    { code: 'q1_other', type: 'short', required: true, metric: 'reason_other', text: 'Please tell us the other reason', showIf: [{ code: 'q1', anyOf: ['Other'] }] },
    { code: 'q2', type: 'stars', required: true, metric: 'overall', text: 'How would you rate your overall experience at the {company}?' },
    { code: 'q3', type: 'choice', required: true, metric: 'factor', factor: 'Line manager relationship', text: 'How was your relationship with your line manager?',
      options: [o('Excellent', { score: 5 }), o('Good', { score: 4 }), o('Neutral', { score: 3 }), o('Difficult', { score: 1 })] },
    { code: 'q4', type: 'choice', required: true, metric: 'factor', factor: 'Career progression and growth', text: 'Did you feel there were enough growth opportunities here?',
      options: [o('Yes', { score: 5 }), o('Somewhat', { score: 3 }), o('No', { score: 1 })] },
    { code: 'q4_comment', type: 'long', required: false, metric: 'text_growth', text: 'What was missing? (growth comment)', showIf: [{ code: 'q4', anyOf: ['Somewhat', 'No'] }] },
    { code: 'q5', type: 'choice', required: true, metric: 'factor', factor: 'Work environment', text: 'How was the work environment?',
      options: [o('Great', { score: 5 }), o('Good', { score: 4 }), o('Neutral', { score: 3 }), o('Stressful', { score: 2 }), o('Toxic', { score: 1 })] },
    { code: 'q6', type: 'choice', required: true, metric: 'factor', factor: 'Tools and resources', text: 'Were you provided the tools and resources needed to do your job?',
      options: [o('Yes', { score: 5 }), o('Partially', { score: 3 }), o('No', { score: 1 })] },
    { code: 'q7', type: 'long', required: true, metric: 'text_stay', text: 'Is there anything the {company} could have done to make you stay?' },
    { code: 'q8', type: 'choice', required: true, metric: 'return_refer', text: 'Would you return to the {company} or refer someone here?',
      options: [o('Both yes', { ret: true, ref: true }), o('Would return only', { ret: true, ref: false }), o('Would refer only', { ret: false, ref: true }), o('Neither', { ret: false, ref: false })] },
    { code: 'q9', type: 'long', required: false, metric: 'text_other', text: 'Any final message to leadership? (optional)' },
  ],
};

export const RATING_LABELS = { 1: 'Very poor', 2: 'Poor', 3: 'Fair', 4: 'Good', 5: 'Very good' };

// Employee details shown at the top of the form (official HR data, read-only).
// Grade, date of joining and length of service are deliberately not shown.
export const ABOUT_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'employee_uid', label: 'Employee ID' },
  { key: 'job_title', label: 'Job title' },
  { key: 'division', label: 'Division' },
  { key: 'department', label: 'Department' },
  { key: 'last_day', label: 'Last working day', type: 'date' },
];

// "How do we reach out to you?" — the last section of the form.
export const CONTACT_FIELDS = [
  { key: 'personal_email', label: 'Personal email', type: 'email', hint: 'For your experience letter and final settlement' },
  { key: 'mobile', label: 'Mobile number', type: 'tel' },
  { key: 'contact_method', label: 'Preferred contact', type: 'select', options: ['Email', 'Phone', 'Either'] },
];
