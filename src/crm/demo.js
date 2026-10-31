import { DEMO_FIELDS, DEMO_LEADS } from "./demoData.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS demo_lead_fields (
  lead_id TEXT NOT NULL,
  field   TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (lead_id, field)
);
CREATE TABLE IF NOT EXISTS demo_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    TEXT NOT NULL,
  note       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

// A pretend CRM with sample leads and call transcripts. Writes are kept
// in the local database so you can see what would reach a real CRM.
export const demo = {
  id: "demo",
  label: "Demo CRM",
  description: "Sample leads with call transcripts. Try the app without a CRM account; nothing leaves your machine.",
  credentialFields: [],
  leadIdHint: "Pick a sample lead",

  create({ store }) {
    store.db.exec(SCHEMA);
    const findLead = (leadId) => {
      const lead = DEMO_LEADS.find((l) => l.id === leadId);
      if (!lead) throw new Error(`Demo lead "${leadId}" not found`);
      return lead;
    };

    return {
      async testConnection() {
        return { ok: true, message: `Demo CRM ready with ${DEMO_LEADS.length} sample leads.` };
      },

      async listRecordedCalls(leadId) {
        return findLead(leadId)
          .calls.map((c) => ({ ...c, leadId, resourceUrl: null }))
          .sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
      },

      async fetchRecording() {
        throw new Error("Demo calls come with transcripts; there is no audio to download.");
      },

      async updateLead(leadId, fields) {
        findLead(leadId);
        const upsert = store.db.prepare(
          `INSERT INTO demo_lead_fields (lead_id, field, value) VALUES (?, ?, ?)
           ON CONFLICT(lead_id, field) DO UPDATE SET value = excluded.value`
        );
        for (const f of fields) upsert.run(leadId, f.field, f.value);
      },

      async addNote(leadId, note) {
        findLead(leadId);
        const r = store.db
          .prepare("INSERT INTO demo_notes (lead_id, note, created_at) VALUES (?, ?, ?)")
          .run(leadId, note, new Date().toISOString());
        return { id: String(r.lastInsertRowid) };
      },

      async getLeadName(leadId) {
        return DEMO_LEADS.find((l) => l.id === leadId)?.name ?? null;
      },

      async listFields() {
        return DEMO_FIELDS;
      },

      async listLeads() {
        return DEMO_LEADS.map((l) => ({
          id: l.id,
          name: l.name,
          calls: l.calls.length,
          longestCallSeconds: Math.max(...l.calls.map((c) => Number(c.duration)))
        }));
      },

      // What the lead looks like inside the Demo CRM after syncing.
      async getLead(leadId) {
        const lead = findLead(leadId);
        const fields = store.db
          .prepare("SELECT field, value FROM demo_lead_fields WHERE lead_id = ?")
          .all(leadId);
        const notes = store.db
          .prepare("SELECT id, note, created_at AS createdAt FROM demo_notes WHERE lead_id = ? ORDER BY id DESC")
          .all(leadId);
        return { id: lead.id, name: lead.name, stage: lead.stage, fields, notes };
      }
    };
  }
};
