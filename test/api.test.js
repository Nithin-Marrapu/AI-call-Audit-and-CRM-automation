import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { JobStore } from "../src/db/jobStore.js";
import { createApp } from "../src/server/app.js";
import { config } from "../src/config/index.js";

config.python = fileURLToPath(new URL("./fixtures/fake-llm.sh", import.meta.url));

let server, base, store;

before(async () => {
  store = new JobStore(":memory:");
  store.saveSettings({ crm: "demo", reviewMode: true });
  server = createApp(store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
};

async function waitForJob(id) {
  for (let i = 0; i < 100; i++) {
    const { body } = await api("GET", `/api/jobs/${id}`);
    if (body.state === "done" || body.state === "failed") return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("job timed out");
}

test("settings: get, update, reject bad input; secrets masked", async () => {
  let r = await api("GET", "/api/settings");
  assert.equal(r.body.crm, "demo");
  r = await api("PUT", "/api/settings", { credentials: { leadsquared: { secretKey: "SECRET1234" } } });
  assert.equal(r.status, 200);
  assert.equal(r.body.credentials.leadsquared.secretKey, "••••1234");
  r = await api("PUT", "/api/settings", { minCallMinutes: 500 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /0-120/);
});

test("crm: list, test connection, fields, leads", async () => {
  assert.deepEqual((await api("GET", "/api/crms")).body.crms.map((c) => c.id), ["leadsquared", "demo"]);
  assert.equal((await api("POST", "/api/crm/test", {})).body.ok, true);
  const bad = await api("POST", "/api/crm/test", { crm: "leadsquared" });
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.message, /not configured/);
  assert.ok((await api("GET", "/api/crm/fields")).body.fields.length > 0);
  assert.equal((await api("GET", "/api/crm/leads")).body.leads.length, 4);
});

test("process -> review -> edit + approve -> note in Demo CRM -> accuracy", async () => {
  const queued = await api("POST", "/api/process", { leadId: "demo-lead-priya" });
  assert.equal(queued.status, 202);
  const job = await waitForJob(queued.body.id);
  assert.equal(job.state, "done", job.error);
  assert.equal(job.result.status, "review");
  assert.ok(job.logs.some((l) => /Waiting for review/.test(l.msg)));

  const id = job.result.activityId;
  const detail = (await api("GET", `/api/calls/${id}`)).body;
  assert.equal(detail.analysis.interest_level, "hot");
  assert.match(detail.note.content, /<b>AI Call Summary<\/b>/);
  assert.equal((await api("GET", "/api/crm/leads/demo-lead-priya")).body.notes.length, 0);

  const edited = { ...detail.analysis, interest_level: "warm" };
  const approved = await api("POST", `/api/calls/${id}/approve`, { analysis: edited });
  assert.equal(approved.status, 200, approved.body.error);
  assert.equal(approved.body.status, "synced");
  assert.equal(approved.body.reviewAction, "edited");

  const lead = (await api("GET", "/api/crm/leads/demo-lead-priya")).body;
  assert.equal(lead.notes.length, 1);
  assert.match(lead.notes[0].note, /Interest: WARM/);
  assert.ok(lead.fields.some((f) => f.field === "city" && f.value === "Pune"));

  const again = await api("POST", `/api/calls/${id}/approve`, {});
  assert.equal(again.status, 400, "cannot approve twice");

  const acc = (await api("GET", "/api/accuracy")).body;
  assert.equal(acc.reviewedCalls, 1);
  assert.equal(acc.fields.find((f) => f.path === "interest_level").accuracy, 0);
  assert.equal(acc.fields.find((f) => f.path === "call_type").accuracy, 100);

  const stats = (await api("GET", "/api/stats")).body;
  assert.equal(stats.interest.warm, 1);
  const list = (await api("GET", "/api/calls")).body;
  assert.equal(list.calls[0].leadName, "Priya Sharma", "CRM name, not the name heard on the call");
});

test("process: lead with only short calls queues fine and sends nothing", async () => {
  const q = await api("POST", "/api/process", { leadId: "demo-lead-rahul", minMinutes: 30 });
  const job = await waitForJob(q.body.id);
  assert.equal(job.state, "done");
  assert.equal(job.result, null);
  assert.ok(job.logs.some((l) => /long enough/.test(l.msg)));
});

test("errors: unknown call, missing leadId, unknown lead", async () => {
  assert.equal((await api("GET", "/api/calls/nope")).status, 404);
  assert.equal((await api("POST", "/api/process", {})).status, 400);
  const q = await api("POST", "/api/process", { leadId: "no-such-lead" });
  const job = await waitForJob(q.body.id);
  assert.equal(job.state, "failed");
  assert.match(job.error, /not found/);
  assert.equal((await api("GET", "/api/nothing")).status, 404);
});

test("audio: served with range support when saved, 404 otherwise", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { callDir } = await import("../src/pipeline.js");
  config.paths.callsDir = fs.mkdtempSync(path.join(os.tmpdir(), "calls-"));

  store.upsertDiscovered({ activityId: "with-audio", leadId: "L1", crm: "demo" });
  fs.mkdirSync(callDir("with-audio"), { recursive: true });
  fs.writeFileSync(path.join(callDir("with-audio"), "audio.mp3"), Buffer.alloc(5000, 7));

  assert.equal((await api("GET", "/api/calls/with-audio")).body.hasAudio, true);
  const full = await fetch(`${base}/api/calls/with-audio/audio`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mpeg");
  const part = await fetch(`${base}/api/calls/with-audio/audio`, { headers: { Range: "bytes=100-199" } });
  assert.equal(part.status, 206, "seeking works");
  assert.equal((await part.arrayBuffer()).byteLength, 100);

  store.upsertDiscovered({ activityId: "no-audio", leadId: "L1", crm: "demo" });
  assert.equal((await api("GET", "/api/calls/no-audio")).body.hasAudio, false);
  assert.equal((await fetch(`${base}/api/calls/no-audio/audio`)).status, 404);
});

test("calls: search, interest and date filters; CSV export with the same filters", async () => {
  // Priya's call is synced and was edited to "warm" earlier in this file.
  let r = (await api("GET", "/api/calls?q=dashboards")).body;
  assert.ok(r.calls.some((c) => c.activityId === "demo-call-priya-1"), "found by transcript text");
  assert.equal(r.total, r.calls.length);

  r = (await api("GET", "/api/calls?q=no-such-words-anywhere")).body;
  assert.equal(r.total, 0);

  r = (await api("GET", "/api/calls?q=100%25_")).body;
  assert.equal(r.total, 0, "% and _ are matched literally");

  r = (await api("GET", "/api/calls?interest=warm")).body;
  assert.deepEqual(r.calls.map((c) => c.interest), ["warm"]);
  assert.equal((await api("GET", "/api/calls?interest=hot")).body.total, 0, "reviewer's edit is what counts");
  assert.ok((await api("GET", "/api/calls?interest=bogus")).body.total > 1, "unknown filter values ignored");

  assert.equal((await api("GET", "/api/calls?days=2&q=dashboards")).body.total, 1, "yesterday's call is within 2 days");
  assert.equal((await api("GET", "/api/calls?days=2&q=dashboards&status=failed")).body.total, 0, "filters combine");

  const res = await fetch(`${base}/api/calls.csv?interest=warm`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="call-audits-/);
  const csv = await res.text();
  const lines = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(lines.length, 2, "header + 1 row");
  assert.match(lines[0], /^Call date \(UTC\),Lead,Lead ID/);
  assert.match(lines[1], /demo-lead-priya/);
  assert.match(lines[1], /,warm,/);
});

test("lead name lookup for the Audit a lead box", async () => {
  assert.deepEqual((await api("GET", "/api/crm/leads/demo-lead-arjun/name")).body, { found: true, name: "Arjun Reddy" });
  assert.deepEqual((await api("GET", "/api/crm/leads/nobody/name")).body, { found: false, name: null });
});
