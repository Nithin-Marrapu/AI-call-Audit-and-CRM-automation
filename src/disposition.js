// Fills the lead's call outcome ("Phone Answered" in LeadSquared) after
// every call, so counsellors don't mark it by hand.
//
// Each decision gets a confidence. Confident ones are written to the CRM;
// unsure ones wait in a queue for a person. The label set is small and a
// wrong label is cheap to catch, so the rules stay simple and visible.

export const OUTCOMES = ["answered", "rnr", "invalid"];
export const OUTCOME_TEXT = { answered: "Answered", rnr: "Not answered (RNR)", invalid: "Number does not exist" };

export const DISPOSITION_DEFAULTS = {
  enabled: false,
  field: "mx_Phone_Answered",
  values: { answered: "Yes", rnr: "No (RNR)", invalid: "Number does not exist" }
};

// Answered calls shorter than this may be voicemail or a network message.
const VERY_SHORT_SECONDS = 20;

const CONVERSATION = new Set(["sales_conversation", "existing_student_support", "customer_unavailable", "other"]);

// Decides the outcome of one call from the dialer's status, its length
// and, for audited calls, what the AI heard.
// Returns { outcome, confidence: "high" | "low", reason }.
export function decideOutcome(call, analysis = null) {
  const status = `${call.dialerStatus ?? ""} ${call.callType ?? ""}`.toLowerCase().trim();
  const seconds = Number(call.duration) || 0;

  const invalidHint = /invalid|not exist|does not exist|unallocated|not reachable|out of service|wrong number/.test(status);
  const notAnswered = /not ?answered|no ?answer|unanswered|missed|busy|reject|declin|cancel|fail|no response|noanswer/.test(status);
  const answered = !notAnswered && /answered|complete|connected/.test(status);

  if (invalidHint) return { outcome: "invalid", confidence: "high", reason: `Dialer status "${status}"` };
  if (notAnswered) return { outcome: "rnr", confidence: "high", reason: `Dialer status "${status}"` };

  if (answered) {
    if (analysis) {
      const type = analysis.call_type;
      if (CONVERSATION.has(type)) return { outcome: "answered", confidence: "high", reason: "Answered, and the AI heard a conversation" };
      if (type === "wrong_number") return { outcome: "invalid", confidence: "low", reason: "Dialer says answered, AI heard a wrong number" };
      return { outcome: "answered", confidence: "low", reason: `Dialer says answered, AI heard "${String(type).replace(/_/g, " ")}"` };
    }
    if (seconds > 0 && seconds < VERY_SHORT_SECONDS) {
      return { outcome: "answered", confidence: "low", reason: `Answered but only ${seconds}s: could be voicemail or a network message` };
    }
    return { outcome: "answered", confidence: "high", reason: `Dialer status "${status}", ${seconds}s` };
  }

  if (!status && seconds === 0) return { outcome: "rnr", confidence: "low", reason: "No dialer status and 0 seconds" };
  return { outcome: null, confidence: "low", reason: status ? `Unknown dialer status "${status}"` : "No dialer status" };
}

// What to do with the lead's current value. A value a person chose is
// kept, except that "not answered" may become "answered" (a later call
// got through). Returns "write" | "same" | "keep".
export function overwriteRule(current, next, values) {
  const cur = String(current ?? "").trim();
  if (!cur) return "write";
  if (cur === values[next]) return "same";
  if (cur === values.rnr && next === "answered") return "write";
  return "keep";
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dispositions (
  activity_id TEXT PRIMARY KEY,
  lead_id     TEXT NOT NULL,
  lead_name   TEXT,
  created_on  TEXT,
  duration    TEXT,
  dialer_status TEXT,
  outcome     TEXT,
  confidence  TEXT NOT NULL,
  reason      TEXT,
  state       TEXT NOT NULL,   -- written | same | kept | pending | skipped | failed | off
  value       TEXT,            -- what was written to the CRM
  previous    TEXT,            -- the lead's value before
  by_person   INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  decided_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_disp_state ON dispositions(state);
`;

const row = (r) =>
  !r ? null : {
    activityId: r.activity_id,
    leadId: r.lead_id,
    leadName: r.lead_name,
    createdOn: r.created_on,
    duration: r.duration,
    dialerStatus: r.dialer_status,
    outcome: r.outcome,
    confidence: r.confidence,
    reason: r.reason,
    state: r.state,
    value: r.value,
    previous: r.previous,
    byPerson: Boolean(r.by_person),
    error: r.error,
    decidedAt: r.decided_at,
    updatedAt: r.updated_at
  };

export class DispositionStore {
  constructor(db) {
    this.db = db;
    db.exec(SCHEMA);
  }

  get(activityId) {
    return row(this.db.prepare("SELECT * FROM dispositions WHERE activity_id = ?").get(String(activityId)));
  }

  save(d) {
    const t = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO dispositions (activity_id, lead_id, lead_name, created_on, duration, dialer_status, outcome, confidence, reason, state, value, previous, by_person, error, decided_at, updated_at)
         VALUES (@activityId, @leadId, @leadName, @createdOn, @duration, @dialerStatus, @outcome, @confidence, @reason, @state, @value, @previous, @byPerson, @error, @t, @t)
         ON CONFLICT(activity_id) DO UPDATE SET lead_name = COALESCE(excluded.lead_name, lead_name), outcome = excluded.outcome,
           confidence = excluded.confidence, reason = excluded.reason, state = excluded.state, value = excluded.value,
           previous = excluded.previous, by_person = excluded.by_person, error = excluded.error, updated_at = excluded.updated_at`
      )
      .run({
        leadName: null,
        createdOn: null,
        duration: null,
        dialerStatus: null,
        outcome: null,
        reason: null,
        value: null,
        previous: null,
        error: null,
        ...d,
        activityId: String(d.activityId),
        byPerson: d.byPerson ? 1 : 0,
        t
      });
    return this.get(d.activityId);
  }

  list({ state, limit = 50 } = {}) {
    const rows = state
      ? this.db.prepare("SELECT * FROM dispositions WHERE state = ? ORDER BY created_on DESC LIMIT ?").all(state, limit)
      : this.db.prepare("SELECT * FROM dispositions ORDER BY created_on DESC LIMIT ?").all(limit);
    return rows.map(row);
  }

  counts() {
    return Object.fromEntries(this.db.prepare("SELECT state, COUNT(*) n FROM dispositions GROUP BY state").all().map((r) => [r.state, r.n]));
  }
}

// Writes one outcome to the lead, respecting overwriteRule.
async function write(crm, config, leadId, outcome) {
  const value = config.values[outcome];
  const current = crm.getLeadValue ? await crm.getLeadValue(leadId, config.field) : null;
  const rule = overwriteRule(current, outcome, config.values);
  if (rule === "write") await crm.updateLead(leadId, [{ field: config.field, value }]);
  return { rule, value, previous: current ?? null };
}

// Decides and (if confident and enabled) writes the outcome of one call.
export async function applyOutcome(dstore, crm, config, call, { analysis = null, leadName = null } = {}) {
  const existing = dstore.get(call.activityId);
  if (existing && ["written", "same", "kept", "skipped"].includes(existing.state)) return existing;

  const decision = decideOutcome(call, analysis);
  const base = {
    activityId: call.activityId,
    leadId: call.leadId,
    leadName,
    createdOn: call.createdOn,
    duration: call.duration,
    dialerStatus: call.dialerStatus ?? call.callType ?? null,
    ...decision
  };

  if (!config.enabled) return dstore.save({ ...base, state: "off" });
  if (decision.confidence !== "high" || !decision.outcome) return dstore.save({ ...base, state: "pending" });

  try {
    const { rule, value, previous } = await write(crm, config, call.leadId, decision.outcome);
    const state = rule === "write" ? "written" : rule === "same" ? "same" : "kept";
    return dstore.save({ ...base, state, value: rule === "write" ? value : null, previous });
  } catch (error) {
    return dstore.save({ ...base, state: "failed", error: error.message });
  }
}

// A person picks the outcome for a call in the queue. Their choice is
// written even over an existing value: they decided.
export async function resolveOutcome(dstore, crm, config, activityId, outcome) {
  const d = dstore.get(activityId);
  if (!d) throw new Error("No such call outcome");
  if (outcome === "skip") return dstore.save({ ...d, state: "skipped", byPerson: true });
  if (!OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of ${OUTCOMES.join(", ")} or skip`);
  const value = config.values[outcome];
  const previous = crm.getLeadValue ? await crm.getLeadValue(d.leadId, config.field) : null;
  await crm.updateLead(d.leadId, [{ field: config.field, value }]);
  return dstore.save({
    ...d,
    outcome,
    state: "written",
    value,
    previous,
    byPerson: true,
    confidence: d.confidence,
    reason: `${d.reason} · chosen by a person`
  });
}
