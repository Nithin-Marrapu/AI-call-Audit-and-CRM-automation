// Maps AI analysis fields -> LeadSquared lead fields.
// Run `npm run lsq:fields` to find the schema names in your account.
// A field is only written when the AI produced a non-empty value.

export const LEAD_FIELD_MAPPING = [
  { from: "customer.experience", to: "mx_Work_Experience" },
  { from: "customer.designation", to: "mx_Job_Role" },
  { from: "customer.company", to: "Company" }
];

// The audit summary is added as a new note on the lead's Notes tab
// (whole-lead notes), never written into a form's notes field.
