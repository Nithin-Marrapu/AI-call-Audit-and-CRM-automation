import { demo } from "./demo.js";
import { leadsquared } from "./leadsquared.js";

// Every CRM adapter implements the same interface:
//   testConnection()                 -> { ok, message }
//   listRecordedCalls(leadId)        -> [{ activityId, leadId, createdOn, duration, resourceUrl?, transcript? }]
//   fetchRecording(call, path)       -> bytes written (skipped when the call has a transcript)
//   updateLead(leadId, [{ field, value }])
//   addNote(leadId, note)            -> { id }
//   listFields()                     -> [{ name, label, type }]
//   getLeadName(leadId)              -> "First Last", or null if no such lead
//   listLeads?() / getLead?(leadId)  -> optional, for CRMs that can list leads
// Adding a CRM = one new file here + registering it below.
export const CONNECTORS = { leadsquared, demo };

export function connectorInfo() {
  return Object.values(CONNECTORS).map(({ id, label, description, credentialFields, leadIdHint }) => ({
    id,
    label,
    description,
    credentialFields,
    leadIdHint
  }));
}

export function createCrm(settings, store) {
  const connector = CONNECTORS[settings.crm];
  if (!connector) throw new Error(`Unknown CRM "${settings.crm}"`);
  const instance = connector.create({ credentials: settings.credentials?.[settings.crm] || {}, store });
  return {
    id: connector.id,
    label: connector.label,
    fieldMapping: settings.fieldMapping?.[connector.id] || [],
    noteFormat: settings.noteFormat,
    ...instance
  };
}

// Uploaded recordings that aren't linked to a CRM lead: analyzed and
// kept in the app, never written anywhere.
export const UPLOAD_ONLY = {
  id: "upload",
  label: "Uploads",
  writesToCrm: false,
  fieldMapping: [],
  async fetchRecording() {
    throw new Error("The uploaded recording is missing. Upload it again.");
  }
};

// A call is always finished in the CRM it came from, even if the
// active CRM was changed in Settings since.
export function createCrmForJob(settings, store, job) {
  if (job?.crm === UPLOAD_ONLY.id) return UPLOAD_ONLY;
  return createCrm({ ...settings, crm: job?.crm && CONNECTORS[job.crm] ? job.crm : settings.crm }, store);
}
