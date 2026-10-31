import { createClient } from "../clients/leadsquared.js";
import { config } from "../config/index.js";
import { countCalls, extractRecordedCalls } from "../stages/discover.js";
import { downloadRecording } from "../stages/download.js";

const ROWS = 200;
const MAX_PAGES = 5;

async function fetchPages(client, leadId, activityEvent) {
  const byId = new Map();
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await client.getLeadActivities(leadId, { activityEvent, page, rowCount: ROWS });
    const rows = result?.ProspectActivities || [];
    const before = byId.size;
    for (const a of rows) byId.set(String(a.Id), a);
    // Stop on a short page, or when a page brings nothing new.
    if (rows.length < ROWS || byId.size === before) break;
  }
  return [...byId.values()];
}

// All phone-call activities of a lead (not just the latest 25).
// Asks for each call event code; if the account ignores the filter and
// returns nothing, falls back to all activities filtered here.
export async function fetchCallActivities(client, leadId) {
  const byId = new Map();
  for (const code of config.callEventCodes) {
    for (const a of await fetchPages(client, leadId, code)) byId.set(String(a.Id), a);
  }
  if (byId.size === 0) {
    for (const a of await fetchPages(client, leadId, undefined)) byId.set(String(a.Id), a);
  }
  return [...byId.values()];
}

export const leadsquared = {
  id: "leadsquared",
  label: "LeadSquared",
  description: "Recorded calls from LeadSquared phone activities (e.g. Acefone). Audit is added to the lead's Notes tab.",
  credentialFields: [
    { key: "host", label: "API host", placeholder: "https://api-in21.leadsquared.com/v2" },
    { key: "accessKey", label: "Access key", secret: true },
    { key: "secretKey", label: "Secret key", secret: true },
    { key: "authMode", label: "Auth mode", options: ["header", "query"] }
  ],
  leadIdHint: "Lead ID from the lead page URL (after LeadID=)",

  create({ credentials }) {
    const client = createClient(credentials);

    return {
      async testConnection() {
        const fields = await client.getLeadsMetadata();
        return { ok: true, message: `Connected. ${fields.length} lead fields found.` };
      },

      async listRecordedCalls(leadId) {
        const activities = await fetchCallActivities(client, leadId);
        const calls = extractRecordedCalls(activities, leadId);
        // Lets the pipeline explain an empty result.
        Object.defineProperty(calls, "summary", { value: countCalls(activities) });
        return calls;
      },

      fetchRecording: (call, destination, opts) => downloadRecording(call.resourceUrl, destination, opts),

      async updateLead(leadId, fields) {
        if (!fields.length) return;
        await client.updateLeadFields(
          leadId,
          fields.map((f) => ({ Attribute: f.field, Value: f.value }))
        );
      },

      async getLeadName(leadId) {
        const [lead] = (await client.getLeadById(leadId)) || [];
        if (!lead) return null;
        const name = [lead.FirstName, lead.LastName].filter((p) => p && String(p).trim()).join(" ").trim();
        return name || lead.EmailAddress || lead.Phone || "(no name)";
      },

      async addNote(leadId, note) {
        const response = await client.createLeadNote({ leadId, note });
        return { id: response?.Message?.Id ?? null };
      },

      async listFields() {
        const fields = await client.getLeadsMetadata();
        return fields
          .map((f) => ({ name: f.SchemaName, label: f.DisplayName, type: f.DataType }))
          .sort((a, b) => String(a.label).localeCompare(String(b.label)));
      }
    };
  }
};
