import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { STATUS } from "../db/jobStore.js";
import crypto from "node:crypto";
import { CONNECTORS, UPLOAD_ONLY, connectorInfo, createCrm, createCrmForJob } from "../crm/index.js";
import { audioDuration, convertUpload } from "../stages/preprocess.js";
import { applySettingsUpdate, loadSettings, publicSettings } from "../settings.js";
import { callDir, processCall, processLead } from "../pipeline.js";
import { approveCall, rejectCall } from "../review.js";
import { computeAccuracy } from "../accuracy.js";
import { topObjections } from "../objections.js";
import { buildAuditNote } from "../stages/sync.js";
import { DEMO_LEADS } from "../crm/demoData.js";
import { JobQueue } from "./queue.js";
import * as schema from "../config/schema.js";
import { TRACKED_FIELDS } from "../accuracy.js";

// AI fields that can be copied into a CRM lead field.
const MAPPABLE_FIELDS = [
  ["customer.name", "Name"],
  ["customer.current_status", "Current status"],
  ["customer.qualification", "Qualification"],
  ["customer.graduation_year", "Graduation year"],
  ["customer.background", "Background (tech / non-tech)"],
  ["customer.experience", "Experience"],
  ["customer.designation", "Job role"],
  ["customer.company", "Company"],
  ["customer.location", "Location"],
  ["intent", "What the lead wants"],
  ["interest_level", "Interest level"],
  ["demo_status", "Demo status"],
  ["course_discussed", "Course discussed"],
  ["outcome", "Outcome"],
  ["call_type", "Call type"],
  ["follow_up_required", "Follow-up needed"]
].map(([path, label]) => ({ path, label }));

const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const demoNames = Object.fromEntries(DEMO_LEADS.map((l) => [l.id, l.name]));

// Short version of a call for lists.
function summarize(job) {
  const a = job.finalAnalysis ?? job.analysis;
  return {
    activityId: job.activityId,
    leadId: job.leadId,
    // CRM name first: the AI only knows how the name sounded on the call.
    leadName: job.leadName || demoNames[job.leadId] || a?.customer?.name || null,
    crm: job.crm,
    createdOn: job.createdOn,
    duration: job.duration ? Number(job.duration) : null,
    status: job.status,
    stage: job.stage,
    callType: a?.call_type ?? null,
    outcome: a?.outcome ?? null,
    interest: a?.interest_level ?? null,
    demoStatus: a?.demo_status ?? null,
    followUp: a?.follow_up_required ?? null,
    summary: a?.call_summary ?? null,
    reviewAction: job.reviewAction,
    lastError: job.lastError,
    attempts: job.attempts,
    updatedAt: job.updatedAt
  };
}

const INTERESTS = new Set(schema.INTEREST_LEVELS);
const STATUSES = new Set(Object.values(STATUS));

// Reads list filters from the query string, ignoring unknown values.
function callFilters(q) {
  const days = Number(q.days);
  return {
    status: STATUSES.has(q.status) ? q.status : undefined,
    leadId: q.leadId || undefined,
    interest: INTERESTS.has(q.interest) ? q.interest : undefined,
    q: typeof q.q === "string" ? q.q.slice(0, 200) : undefined,
    since: Number.isFinite(days) && days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : undefined
  };
}

// Spreadsheet apps run cells starting with = + - @ as formulas.
const cell = (v) => {
  if (v === null || v === undefined) return "";
  let t = Array.isArray(v) ? v.join("; ") : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

function toCsv(jobs) {
  const head = [
    "Call date (UTC)", "Lead", "Lead ID", "CRM", "Length (min)", "Status", "Call type", "Outcome",
    "Interest", "Why", "Demo", "Follow-up", "Wants", "Course", "Fees", "Objections", "Next steps",
    "Summary", "Review"
  ];
  const lines = jobs.map((j) => {
    const a = j.finalAnalysis ?? j.analysis ?? {};
    return [
      j.createdOn,
      j.leadName || demoNames[j.leadId] || a.customer?.name,
      j.leadId,
      j.crm,
      j.duration ? (Number(j.duration) / 60).toFixed(1) : "",
      j.status,
      a.call_type,
      a.outcome,
      a.interest_level,
      a.interest_reason,
      a.demo_status,
      a.follow_up_required == null ? "" : a.follow_up_required ? "yes" : "no",
      a.intent === "unknown" ? "" : a.intent,
      a.course_discussed,
      a.fees_discussed,
      (a.objections || []).map((o) => `${o.concern}${o.resolved ? " (resolved)" : ""}`),
      (a.next_steps || []).map((n) => `${n.action}${n.when ? ` (${n.when})` : ""}`),
      a.call_summary,
      j.reviewAction
    ].map(cell).join(",");
  });
  // BOM so Excel opens it as UTF-8.
  return "\uFEFF" + [head.join(","), ...lines].join("\r\n");
}

// Fills in names for calls audited before names were stored. Runs once
// in the background at startup, gently (LeadSquared allows 25 calls / 5 s).
export async function backfillLeadNames(store, { log = () => {} } = {}) {
  const s = loadSettings(store);
  if (s.crm !== "leadsquared") return 0;
  const crm = createCrm(s, store);
  let filled = 0;
  for (const leadId of store.leadsWithoutName(["leadsquared"]).slice(0, 200)) {
    try {
      const name = await crm.getLeadName(leadId);
      if (name) {
        store.setLeadName(leadId, name);
        filled++;
      }
    } catch (error) {
      log(`Couldn't fetch lead names: ${error.message}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return filled;
}

export function createApp(store, { queue = new JobQueue() } = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const settings = () => loadSettings(store);
  const activeCrm = () => createCrm(settings(), store);
  const getJob = (id) => {
    const job = store.get(id);
    if (!job) throw new HttpError(404, "Call not found");
    return job;
  };

  app.get("/api/health", (req, res) => res.json({ ok: true, busy: queue.busy() }));

  app.get("/api/schema", (req, res) =>
    res.json({
      callTypes: schema.CALL_TYPES,
      outcomes: schema.OUTCOMES,
      interestLevels: schema.INTEREST_LEVELS,
      demoStatuses: schema.DEMO_STATUSES,
      currentStatuses: schema.CURRENT_STATUSES,
      backgrounds: schema.BACKGROUNDS,
      customerFields: schema.CUSTOMER_FIELDS,
      mappableFields: MAPPABLE_FIELDS,
      trackedFields: TRACKED_FIELDS
    })
  );

  // ---------- CRM + settings ----------
  app.get("/api/crms", (req, res) => res.json({ active: settings().crm, crms: connectorInfo() }));

  app.get("/api/settings", (req, res) => res.json(publicSettings(settings(), CONNECTORS)));

  app.put("/api/settings", (req, res) => {
    const update = applySettingsUpdate(settings(), req.body, CONNECTORS);
    store.saveSettings(update);
    res.json(publicSettings(settings(), CONNECTORS));
  });

  // Tests the CRM with the values in the form, saved or not.
  app.post("/api/crm/test", async (req, res) => {
    const current = settings();
    const draft = { ...current, ...applySettingsUpdate(current, req.body || {}, CONNECTORS) };
    try {
      res.json(await createCrm(draft, store).testConnection());
    } catch (error) {
      res.json({ ok: false, message: error.message });
    }
  });

  app.get("/api/crm/fields", async (req, res) => {
    res.json({ crm: settings().crm, fields: await activeCrm().listFields() });
  });

  app.get("/api/crm/leads", async (req, res) => {
    const crm = activeCrm();
    if (!crm.listLeads) return res.json({ supported: false, leads: [] });
    res.json({ supported: true, leads: await crm.listLeads() });
  });

  // Name lookup for the "Audit a lead" box, as the ID is pasted.
  app.get("/api/crm/leads/:id/name", async (req, res) => {
    const crm = activeCrm();
    if (!crm.getLeadName) return res.json({ found: null, name: null });
    try {
      const name = await crm.getLeadName(req.params.id.trim());
      if (name) store.setLeadName(req.params.id.trim(), name);
      res.json({ found: Boolean(name), name });
    } catch (error) {
      res.json({ found: null, name: null, error: error.message });
    }
  });

  app.get("/api/crm/leads/:id", async (req, res) => {
    const crm = activeCrm();
    if (!crm.getLead) throw new HttpError(404, `${crm.label} lead view is not available here`);
    res.json(await crm.getLead(req.params.id));
  });

  // ---------- calls ----------
  app.get("/api/calls", (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const filters = callFilters(req.query);
    const calls = store.list({ ...filters, limit, offset }).map(summarize);
    res.json({ calls, total: store.count(filters), counts: store.counts() });
  });

  // Same filters as the list, as a spreadsheet.
  app.get("/api/calls.csv", (req, res) => {
    const rows = store.list({ ...callFilters(req.query), limit: 10000 });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="call-audits-${stamp}.csv"`);
    res.send(toCsv(rows));
  });

  app.get("/api/calls/:id", (req, res) => {
    const job = getJob(req.params.id);
    const analysis = job.finalAnalysis ?? job.analysis;
    const format = settings().noteFormat;
    res.json({
      ...job,
      hasAudio: fs.existsSync(path.join(callDir(job.activityId), "audio.mp3")),
      summary: summarize(job),
      note: analysis ? { format, content: buildAuditNote(analysis, job, format) } : null
    });
  });

  // Streams the call recording (supports seeking via Range requests).
  app.get("/api/calls/:id/audio", (req, res) => {
    const job = getJob(req.params.id);
    const file = path.join(callDir(job.activityId), "audio.mp3");
    if (!fs.existsSync(file)) throw new HttpError(404, "No recording saved for this call");
    res.sendFile(file, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
  });

  app.post("/api/calls/:id/approve", async (req, res) => {
    const job = getJob(req.params.id);
    const crm = createCrmForJob(settings(), store, job);
    try {
      const updated = await approveCall(store, job.activityId, { crm, edited: req.body?.analysis });
      res.json(summarize(updated));
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  });

  app.post("/api/calls/:id/reject", (req, res) => {
    const job = getJob(req.params.id);
    try {
      res.json(summarize(rejectCall(store, job.activityId)));
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  });

  app.post("/api/calls/:id/retry", (req, res) => {
    const job = getJob(req.params.id);
    if (job.stage === STATUS.SYNCED) throw new HttpError(400, "Already sent to the CRM.");
    const s = settings();
    const queued = queue.add(`Retry ${job.activityId.slice(0, 8)}`, { activityId: job.activityId }, async (log, signal) => {
      const done = await processCall(store, job.activityId, {
        crm: createCrmForJob(s, store, job),
        reviewMode: s.reviewMode,
        log,
        signal
      });
      return summarize(done);
    });
    res.status(202).json(queued);
  });

  // ---------- processing ----------
  app.post("/api/process", (req, res) => {
    const leadId = String(req.body?.leadId || "").trim();
    if (!leadId) throw new HttpError(400, "leadId is required");
    const s = settings();
    const minutes = req.body?.minMinutes ?? s.minCallMinutes;
    const crm = createCrm(s, store);
    const job = queue.add(`Process lead ${leadId}`, { leadId, crm: crm.id }, async (log, signal) => {
      const done = await processLead(store, leadId, {
        crm,
        force: req.body?.force === true,
        minSeconds: Number(minutes) * 60,
        reviewMode: s.reviewMode,
        log,
        signal
      });
      return done ? summarize(done) : null;
    });
    res.status(202).json(job);
  });

  // Audit an uploaded recording. The raw file is the request body.
  // With ?leadId the note goes to that lead in the active CRM;
  // without it the analysis stays in the app.
  app.post(
    "/api/upload",
    express.raw({ type: () => true, limit: "200mb" }),
    async (req, res) => {
      if (!req.body?.length) throw new HttpError(400, "Choose an audio file to upload.");
      const s = settings();
      const leadId = String(req.query.leadId || "").trim();
      const fileName = String(req.query.filename || "recording").slice(0, 120);
      const name = String(req.query.name || "").trim().slice(0, 120) || fileName.replace(/\.[^.]+$/, "");

      const id = `upload-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
      const dir = callDir(id);
      fs.mkdirSync(dir, { recursive: true });
      const raw = path.join(dir, "upload.bin");
      fs.writeFileSync(raw, req.body);
      try {
        await convertUpload(raw, path.join(dir, "audio.mp3"));
      } catch {
        fs.rmSync(dir, { recursive: true, force: true });
        throw new HttpError(400, "That file isn't audio we can read. Try mp3, wav, m4a or ogg.");
      } finally {
        fs.rmSync(raw, { force: true });
      }
      const duration = await audioDuration(path.join(dir, "audio.mp3")).catch(() => null);

      const crm = leadId ? createCrm(s, store) : UPLOAD_ONLY;
      store.upsertDiscovered({
        activityId: id,
        leadId: leadId || "upload",
        crm: crm.id,
        leadName: name,
        createdOn: new Date().toISOString().slice(0, 19).replace("T", " "),
        duration: duration == null ? null : String(duration)
      });
      store.advance(id, STATUS.DOWNLOADED);

      const job = queue.add(`Upload ${name}`, { activityId: id, crm: crm.id }, async (log, signal) => {
        log.ok(`Uploaded ${fileName}${duration ? ` (${Math.floor(duration / 60)}m ${duration % 60}s)` : ""}`);
        const done = await processCall(store, id, { crm, reviewMode: s.reviewMode, log, signal });
        return summarize(done);
      });
      res.status(202).json(job);
    }
  );

  app.get("/api/jobs", (req, res) => res.json({ jobs: queue.list() }));

  app.post("/api/jobs/stop-all", (req, res) => res.json({ stopped: queue.stopAll() }));

  app.post("/api/jobs/:id/stop", (req, res) => {
    if (!queue.get(req.params.id)) throw new HttpError(404, "Job not found");
    if (!queue.stop(req.params.id)) throw new HttpError(400, "This job has already finished.");
    res.json(queue.get(req.params.id));
  });

  app.get("/api/jobs/:id", (req, res) => {
    const job = queue.get(req.params.id);
    if (!job) throw new HttpError(404, "Job not found");
    res.json(job);
  });

  // ---------- insights ----------
  app.get("/api/accuracy", (req, res) => res.json(computeAccuracy(store)));

  app.get("/api/stats", (req, res) => {
    const all = store.all();
    const interest = { hot: 0, warm: 0, cold: 0, unknown: 0 };
    const demo = {};
    let connected = 0;
    for (const j of all) {
      const a = j.finalAnalysis ?? j.analysis;
      if (!a) continue;
      interest[a.interest_level] = (interest[a.interest_level] || 0) + 1;
      if (a.demo_status && a.demo_status !== "unknown") demo[a.demo_status] = (demo[a.demo_status] || 0) + 1;
      if (["sales_conversation", "existing_student_support", "other"].includes(a.call_type)) connected++;
    }
    res.json({
      counts: store.counts(),
      total: all.length,
      connected,
      interest,
      demo,
      objections: topObjections(all, { days: 7 })
    });
  });

  // ---------- web app ----------
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
  }

  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    const status = error.status || (error.message?.startsWith("Unknown") || /must be/.test(error.message) ? 400 : 500);
    res.status(status).json({ error: error.message });
  });

  return app;
}
