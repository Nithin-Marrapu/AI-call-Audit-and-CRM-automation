import { test } from "node:test";
import assert from "node:assert/strict";
import { JobStore, STATUS } from "../src/db/jobStore.js";
import { CONNECTORS, createCrm } from "../src/crm/index.js";
import { applySettingsUpdate, defaultSettings, loadSettings, publicSettings } from "../src/settings.js";
import { processLead, processCall } from "../src/pipeline.js";
import { approveCall, rejectCall } from "../src/review.js";
import { computeAccuracy } from "../src/accuracy.js";
import { validateAnalysis } from "../src/stages/validate.js";
import { config } from "../src/config/index.js";

// Tests must never run the real local models.
config.python = "/nonexistent/python";

const quietLog = { step() {}, ok() {}, info() {}, error() {} };

function demoSetup(overrides = {}) {
  const store = new JobStore(":memory:");
  store.saveSettings({ crm: "demo", ...overrides });
  const settings = loadSettings(store);
  return { store, settings, crm: createCrm(settings, store) };
}

// Puts a demo call at "analyzed" with a given AI analysis, skipping the LLM.
async function analyzedDemoCall(store, crm, leadId, raw) {
  const [call] = (await crm.listRecordedCalls(leadId)).filter((c) => Number(c.duration) > 420);
  store.upsertDiscovered({ ...call, crm: "demo" });
  store.advance(call.activityId, STATUS.TRANSCRIBED, { transcript: call.transcript });
  const { analysis, corrections } = validateAnalysis(raw, call.transcript);
  store.advance(call.activityId, STATUS.ANALYZED, { rawAnalysis: raw, analysis, corrections });
  return call;
}

const aiOutput = {
  call_summary: "Pitched data analytics; demo booked for Saturday.",
  call_type: "sales_conversation",
  customer: { current_status: "working", qualification: "B.Tech", location: "Mumbai", experience: "2.5 years" },
  intent: "Move into a data analyst role",
  interest_level: "warm",
  demo_status: "booked",
  outcome: "interested",
  objections: [],
  next_steps: [],
  key_quotes: [],
  follow_up_required: true,
  audit: {}
};

test("settings: secrets are masked and kept when the UI sends the mask back", () => {
  const store = new JobStore(":memory:");
  const current = loadSettings(store);
  const update = applySettingsUpdate(
    current,
    { crm: "leadsquared", credentials: { leadsquared: { host: "https://h", accessKey: "AK123456", secretKey: "SK987654" } } },
    CONNECTORS
  );
  store.saveSettings(update);
  let s = loadSettings(store);
  const pub = publicSettings(s, CONNECTORS);
  assert.equal(pub.credentials.leadsquared.secretKey, "••••7654");
  assert.equal(pub.credentials.leadsquared.host, "https://h");

  store.saveSettings(
    applySettingsUpdate(s, { credentials: { leadsquared: { host: "https://h2", secretKey: "••••7654", accessKey: "" } } }, CONNECTORS)
  );
  s = loadSettings(store);
  assert.equal(s.credentials.leadsquared.secretKey, "SK987654", "masked value keeps the saved secret");
  assert.equal(s.credentials.leadsquared.accessKey, "AK123456", "empty value keeps the saved secret");
  assert.equal(s.credentials.leadsquared.host, "https://h2");
});

test("settings: rejects bad values", () => {
  const cur = defaultSettings();
  assert.throws(() => applySettingsUpdate(cur, { crm: "nope" }, CONNECTORS), /Unknown CRM/);
  assert.throws(() => applySettingsUpdate(cur, { minCallMinutes: -1 }, CONNECTORS), /0-120/);
  assert.throws(() => applySettingsUpdate(cur, { hack: 1 }, CONNECTORS), /Unknown setting/);
});

test("demo CRM: short newest call is skipped, long call is audited from its transcript", async () => {
  const { store, crm } = demoSetup();
  // config.python points nowhere, so analysis fails fast after transcript.
  const job = await processLead(store, "demo-lead-rahul", { crm, minSeconds: 420, log: quietLog }).catch((e) => e);
  const saved = store.get("demo-call-rahul-1");
  assert.ok(saved, "long call chosen");
  assert.equal(saved.stage, "transcribed", "transcript came from the CRM, no download");
  assert.equal(store.get("demo-call-rahul-2"), null, "24s call never stored");
  assert.ok(job instanceof Error, "LLM unavailable in tests");
});

test("review mode: waits, then approve with edits syncs the reviewer's version", async () => {
  const { store, crm } = demoSetup({ reviewMode: true });
  const call = await analyzedDemoCall(store, crm, "demo-lead-priya", aiOutput);

  let job = await processCall(store, call.activityId, { crm, reviewMode: true, log: quietLog });
  assert.equal(job.status, "review");
  assert.equal((await crm.getLead("demo-lead-priya")).notes.length, 0, "nothing sent before approval");

  const edited = structuredClone(job.analysis);
  edited.customer.location = "Pune";
  job = await approveCall(store, call.activityId, { crm, edited, log: quietLog });
  assert.equal(job.status, "synced");
  assert.equal(job.reviewAction, "edited");

  const lead = await crm.getLead("demo-lead-priya");
  assert.equal(lead.notes.length, 1);
  assert.match(lead.notes[0].note, /Pune/);
  assert.deepEqual(
    lead.fields.find((f) => f.field === "city"),
    { field: "city", value: "Pune" }
  );
});

test("reject: nothing reaches the CRM", async () => {
  const { store, crm } = demoSetup({ reviewMode: true });
  const call = await analyzedDemoCall(store, crm, "demo-lead-meena", { ...aiOutput, interest_level: "hot" });
  await processCall(store, call.activityId, { crm, reviewMode: true, log: quietLog });
  const job = rejectCall(store, call.activityId);
  assert.equal(job.status, "rejected");
  assert.equal((await crm.getLead("demo-lead-meena")).notes.length, 0);
});

test("accuracy: per-field agreement between AI and reviewer", async () => {
  const { store, crm } = demoSetup({ reviewMode: true });
  const a = await analyzedDemoCall(store, crm, "demo-lead-priya", aiOutput);
  const b = await analyzedDemoCall(store, crm, "demo-lead-arjun", { ...aiOutput, interest_level: "hot" });

  await approveCall(store, a.activityId, { crm, log: quietLog }); // unchanged
  const edited = structuredClone(store.get(b.activityId).analysis);
  edited.interest_level = "warm";
  await approveCall(store, b.activityId, { crm, edited, log: quietLog });

  const acc = computeAccuracy(store);
  assert.equal(acc.reviewedCalls, 2);
  assert.deepEqual(acc.actions, { approved: 1, edited: 1, rejected: 0 });
  assert.equal(acc.approvedWithoutEdits, 50);
  const interest = acc.fields.find((f) => f.path === "interest_level");
  assert.equal(interest.accuracy, 50);
  assert.equal(acc.fields.find((f) => f.path === "call_type").accuracy, 100);
  assert.deepEqual(acc.recentEdits[0].fields, ["interest_level"]);
});
