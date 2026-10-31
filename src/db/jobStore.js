import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// Each call moves through these states. A failed call keeps the
// last state it completed, so a retry resumes instead of redoing work.
export const STATUS = {
  DISCOVERED: "discovered",
  DOWNLOADED: "downloaded",
  TRANSCRIBED: "transcribed",
  ANALYZED: "analyzed",
  SYNCED: "synced",
  FAILED: "failed",
  // status only (stage stays "analyzed"): waiting for a person
  REVIEW: "review",
  REJECTED: "rejected",
  STOPPED: "stopped"
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  activity_id   TEXT PRIMARY KEY,
  lead_id       TEXT NOT NULL,
  session_id    TEXT,
  created_on    TEXT,
  duration      TEXT,
  resource_url  TEXT,
  status        TEXT NOT NULL,
  stage         TEXT NOT NULL,          -- last stage completed
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  transcript    TEXT,
  transcript_meta TEXT,
  raw_analysis  TEXT,
  analysis      TEXT,
  corrections   TEXT,
  crm_response  TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  synced_at     TEXT,
  crm           TEXT,
  final_analysis TEXT,
  review_action TEXT,
  reviewed_at   TEXT,
  lead_name     TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calls_lead ON calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
`;

const now = () => new Date().toISOString();
const json = (value) => (value === undefined ? null : JSON.stringify(value));

function rowToJob(row) {
  if (!row) return null;
  const parse = (v) => (v == null ? null : JSON.parse(v));
  return {
    activityId: row.activity_id,
    leadId: row.lead_id,
    sessionId: row.session_id,
    createdOn: row.created_on,
    duration: row.duration,
    resourceUrl: row.resource_url,
    status: row.status,
    stage: row.stage,
    attempts: row.attempts,
    lastError: row.last_error,
    transcript: row.transcript,
    transcriptMeta: parse(row.transcript_meta),
    rawAnalysis: parse(row.raw_analysis),
    analysis: parse(row.analysis),
    corrections: parse(row.corrections),
    crmResponse: parse(row.crm_response),
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
    crm: row.crm,
    finalAnalysis: parse(row.final_analysis),
    reviewAction: row.review_action,
    reviewedAt: row.reviewed_at,
    leadName: row.lead_name
  };
}

export class JobStore {
  constructor(dbPath) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  // Adds columns introduced after a database was first created.
  migrate() {
    const have = new Set(
      this.db.prepare("PRAGMA table_info(calls)").all().map((c) => c.name)
    );
    const added = {
      transcript_meta: "TEXT",
      crm: "TEXT",
      final_analysis: "TEXT",
      review_action: "TEXT",
      reviewed_at: "TEXT",
      lead_name: "TEXT"
    };
    for (const [col, type] of Object.entries(added)) {
      if (!have.has(col)) this.db.exec(`ALTER TABLE calls ADD COLUMN ${col} ${type}`);
    }
  }

  get(activityId) {
    return rowToJob(
      this.db.prepare("SELECT * FROM calls WHERE activity_id = ?").get(String(activityId))
    );
  }

  // Inserts a newly seen call. Existing rows are left untouched.
  upsertDiscovered(call) {
    const ts = now();
    this.db
      .prepare(
        `INSERT INTO calls (activity_id, lead_id, session_id, created_on, duration,
           resource_url, crm, lead_name, status, stage, first_seen_at, updated_at)
         VALUES (@activityId, @leadId, @sessionId, @createdOn, @duration,
           @resourceUrl, @crm, @leadName, 'discovered', 'discovered', @ts, @ts)
         ON CONFLICT(activity_id) DO UPDATE SET
           resource_url = COALESCE(excluded.resource_url, calls.resource_url),
           session_id   = COALESCE(calls.session_id, excluded.session_id),
           created_on   = COALESCE(calls.created_on, excluded.created_on),
           duration     = COALESCE(calls.duration, excluded.duration),
           crm          = COALESCE(calls.crm, excluded.crm),
           lead_name    = COALESCE(excluded.lead_name, calls.lead_name)`
      )
      .run({ sessionId: null, createdOn: null, duration: null, resourceUrl: null, crm: null, leadName: null, ...call, ts });
    return this.get(call.activityId);
  }

  // Records completion of a stage plus any data it produced.
  advance(activityId, stage, data = {}) {
    const columns = {
      transcript: data.transcript,
      transcript_meta: json(data.transcriptMeta),
      raw_analysis: json(data.rawAnalysis),
      analysis: json(data.analysis),
      corrections: json(data.corrections),
      crm_response: json(data.crmResponse),
      final_analysis: json(data.finalAnalysis)
    };
    const sets = Object.entries(columns)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([col]) => `${col} = @${col}`);

    const syncedAt = stage === STATUS.SYNCED ? ", synced_at = @ts" : "";

    this.db
      .prepare(
        `UPDATE calls SET status = @stage, stage = @stage, last_error = NULL,
           updated_at = @ts${syncedAt}${sets.length ? ", " + sets.join(", ") : ""}
         WHERE activity_id = @activityId`
      )
      .run({ ...columns, stage, ts: now(), activityId: String(activityId) });
  }

  // Records partial CRM progress without changing the stage, so a
  // retry knows which CRM writes already happened.
  saveCrmProgress(activityId, progress) {
    this.db
      .prepare(
        `UPDATE calls SET crm_response = @progress, updated_at = @ts
         WHERE activity_id = @activityId`
      )
      .run({ progress: json(progress), ts: now(), activityId: String(activityId) });
  }

  // Stopped by the user: keep the stage, don't count it as a failed attempt.
  markStopped(activityId) {
    this.db
      .prepare(
        `UPDATE calls SET status = 'stopped', last_error = 'Stopped by user', updated_at = @ts
         WHERE activity_id = @activityId`
      )
      .run({ ts: now(), activityId: String(activityId) });
  }

  setLeadName(leadId, name) {
    this.db
      .prepare("UPDATE calls SET lead_name = ? WHERE lead_id = ? AND (lead_name IS NULL OR lead_name != ?)")
      .run(name, String(leadId), name);
  }

  // Lead IDs from a CRM whose calls have no stored name yet.
  leadsWithoutName(crmIds) {
    const marks = crmIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT DISTINCT lead_id FROM calls
         WHERE lead_name IS NULL AND lead_id != 'upload' AND (crm IS NULL OR crm IN (${marks}))`
      )
      .all(...crmIds)
      .map((r) => r.lead_id);
  }

  markFailed(activityId, error) {
    this.db
      .prepare(
        `UPDATE calls SET status = 'failed', attempts = attempts + 1,
           last_error = @error, updated_at = @ts WHERE activity_id = @activityId`
      )
      .run({ error: String(error?.message ?? error), ts: now(), activityId: String(activityId) });
  }

  // Sends a call back through the pipeline from the start.
  reset(activityId) {
    this.db
      .prepare(
        `UPDATE calls SET status = 'discovered', stage = 'discovered', attempts = 0,
           last_error = NULL, crm_response = NULL, final_analysis = NULL,
           review_action = NULL, reviewed_at = NULL, updated_at = @ts
         WHERE activity_id = @activityId`
      )
      .run({ ts: now(), activityId: String(activityId) });
  }

  // Filters for the calls list. `q` searches the transcript, the note
  // content and the lead's name; `since` is an ISO date (call time, UTC).
  static filterSql({ status, leadId, q, interest, since } = {}) {
    const where = [];
    const params = {};
    if (status) (where.push("status = @status"), (params.status = status));
    if (leadId) (where.push("lead_id = @leadId"), (params.leadId = leadId));
    if (interest) {
      where.push("json_extract(COALESCE(final_analysis, analysis), '$.interest_level') = @interest");
      params.interest = interest;
    }
    if (since) {
      where.push("COALESCE(created_on, first_seen_at) >= @since");
      params.since = String(since).replace("T", " ").slice(0, 19);
    }
    if (q && q.trim()) {
      where.push(`(transcript LIKE @q ESCAPE '\\' OR analysis LIKE @q ESCAPE '\\'
        OR final_analysis LIKE @q ESCAPE '\\' OR lead_name LIKE @q ESCAPE '\\'
        OR lead_id LIKE @q ESCAPE '\\' OR activity_id LIKE @q ESCAPE '\\')`);
      params.q = `%${q.trim().replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    }
    return { where: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
  }

  list({ limit = 20, offset = 0, ...filters } = {}) {
    const { where, params } = JobStore.filterSql(filters);
    return this.db
      .prepare(`SELECT * FROM calls ${where} ORDER BY COALESCE(created_on, first_seen_at) DESC, updated_at DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset })
      .map(rowToJob);
  }

  count(filters = {}) {
    const { where, params } = JobStore.filterSql(filters);
    return this.db.prepare(`SELECT COUNT(*) AS n FROM calls ${where}`).get(params).n;
  }

  // Analysis finished; hold it until someone approves or rejects it.
  markReview(activityId) {
    this.db
      .prepare(`UPDATE calls SET status = 'review', updated_at = @ts WHERE activity_id = @activityId`)
      .run({ ts: now(), activityId: String(activityId) });
  }

  // action: "approved" (unchanged), "edited" (approved with changes), "rejected"
  saveReview(activityId, action, finalAnalysis) {
    this.db
      .prepare(
        `UPDATE calls SET review_action = @action, final_analysis = @final, reviewed_at = @ts,
           status = CASE WHEN @action = 'rejected' THEN 'rejected' ELSE status END,
           updated_at = @ts
         WHERE activity_id = @activityId`
      )
      .run({ action, final: json(finalAnalysis ?? null), ts: now(), activityId: String(activityId) });
  }

  // Reviewed calls with both the AI's and the approved version.
  reviewed() {
    return this.db
      .prepare("SELECT * FROM calls WHERE review_action IS NOT NULL AND analysis IS NOT NULL ORDER BY reviewed_at DESC")
      .all()
      .map(rowToJob);
  }

  all() {
    return this.db.prepare("SELECT * FROM calls ORDER BY updated_at DESC").all().map(rowToJob);
  }

  counts() {
    return Object.fromEntries(
      this.db
        .prepare("SELECT status, COUNT(*) AS n FROM calls GROUP BY status")
        .all()
        .map((r) => [r.status, r.n])
    );
  }

  // One-time import of the old processed-calls.json so already
  // processed calls are never sent to the CRM again.
  importLegacy(filePath) {
    if (!fs.existsSync(filePath)) return 0;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return 0;

    const records = JSON.parse(raw);
    if (!Array.isArray(records)) {
      throw new Error(`${filePath} must contain a JSON array.`);
    }

    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO calls (activity_id, lead_id, session_id, status, stage,
         first_seen_at, updated_at, synced_at)
       VALUES (@activityId, @leadId, @sessionId, 'synced', 'synced', @ts, @ts, @processedAt)`
    );

    const run = this.db.transaction((items) => {
      let added = 0;
      for (const r of items) {
        if (!r?.activityId) continue;
        added += insert.run({
          activityId: String(r.activityId),
          leadId: String(r.leadId ?? "unknown"),
          sessionId: r.sessionId ?? null,
          processedAt: r.processedAt ?? now(),
          ts: now()
        }).changes;
      }
      return added;
    });

    return run(records);
  }

  getSettings() {
    return Object.fromEntries(
      this.db.prepare("SELECT key, value FROM settings").all().map((r) => [r.key, JSON.parse(r.value)])
    );
  }

  saveSettings(values) {
    const upsert = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) upsert.run(key, JSON.stringify(value));
    })();
  }

  close() {
    this.db.close();
  }
}
