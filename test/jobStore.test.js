import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JobStore, STATUS } from "../src/db/jobStore.js";
import { extractRecordedCalls } from "../src/stages/discover.js";
import { buildLeadFields, buildAuditNote } from "../src/stages/sync.js";
import { validateAnalysis } from "../src/stages/validate.js";
import { LEAD_FIELD_MAPPING } from "../src/config/crmFields.js";

const call = {
  activityId: "a1",
  leadId: "lead-1",
  sessionId: "s1",
  createdOn: "2026-10-01 10:00:00",
  duration: "120",
  resourceUrl: "https://example.com/a1.mp3"
};

test("job moves through stages and keeps its data", () => {
  const store = new JobStore(":memory:");
  store.upsertDiscovered(call);
  store.advance("a1", STATUS.DOWNLOADED);
  store.advance("a1", STATUS.TRANSCRIBED, { transcript: "hi there" });
  store.markFailed("a1", new Error("model crashed"));

  let job = store.get("a1");
  assert.equal(job.status, "failed");
  assert.equal(job.stage, "transcribed", "failure keeps last completed stage");
  assert.equal(job.transcript, "hi there");
  assert.equal(job.attempts, 1);

  store.advance("a1", STATUS.ANALYZED, { analysis: { outcome: "interested" } });
  store.advance("a1", STATUS.SYNCED, { crmResponse: { Status: "Success" } });
  job = store.get("a1");
  assert.equal(job.status, "synced");
  assert.equal(job.lastError, null);
  assert.equal(job.transcript, "hi there", "earlier data not wiped");
  assert.ok(job.syncedAt);
});

test("rediscovering a call never resets its progress", () => {
  const store = new JobStore(":memory:");
  store.upsertDiscovered(call);
  store.advance("a1", STATUS.SYNCED);
  store.upsertDiscovered(call);
  assert.equal(store.get("a1").stage, "synced");
});

test("imports legacy processed-calls.json once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
  const file = path.join(dir, "processed-calls.json");
  fs.writeFileSync(file, JSON.stringify([{ activityId: "old1", leadId: "L", processedAt: "2026-09-01T00:00:00Z" }]));

  const store = new JobStore(":memory:");
  assert.equal(store.importLegacy(file), 1);
  assert.equal(store.importLegacy(file), 0);
  assert.equal(store.get("old1").stage, "synced");
});

test("extractRecordedCalls filters and sorts newest first", () => {
  const act = (id, created, url, code = "22", name = "Outbound Phone Call Activity") => ({
    Id: id, EventCode: code, EventName: name, CreatedOn: created,
    Data: url ? [{ Key: "ResourceUrl", Value: url }, { Key: "Duration", Value: "60" }] : []
  });
  const calls = extractRecordedCalls(
    [
      act("old", "2026-10-01 09:00:00", "u1"),
      act("new", "2026-10-02 09:00:00", "u2"),
      act("norec", "2026-10-03 09:00:00", null),
      act("email", "2026-10-04 09:00:00", "u3", "1", "Email")
    ],
    "L"
  );
  assert.deepEqual(calls.map((c) => c.activityId), ["new", "old"]);
  assert.equal(calls[0].duration, "60");
});

test("buildLeadFields writes only non-empty mapped fields, no notes field", () => {
  const { analysis } = validateAnalysis(
    {
      call_summary: "x", call_type: "sales_conversation", outcome: "interested",
      customer: { experience: "3 years", designation: null, company: "Infosys" },
      objections: [], audit: {}
    },
    "real talk"
  );
  const fields = buildLeadFields(analysis, LEAD_FIELD_MAPPING);
  assert.deepEqual(fields.map((f) => f.field), ["mx_Work_Experience", "Company"]);
  assert.match(buildAuditNote(analysis, call), /call recording a1 /);
});

test("saveCrmProgress keeps stage; reset clears it", () => {
  const store = new JobStore(":memory:");
  store.upsertDiscovered(call);
  store.advance("a1", STATUS.ANALYZED, { analysis: { outcome: "x" } });
  store.saveCrmProgress("a1", { leadUpdated: true, noteId: "n1" });
  assert.equal(store.get("a1").stage, "analyzed");
  assert.deepEqual(store.get("a1").crmResponse, { leadUpdated: true, noteId: "n1" });
  store.reset("a1");
  assert.equal(store.get("a1").crmResponse, null);
});

import Database from "better-sqlite3";

test("migrates an old database without transcript_meta", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"));
  const file = path.join(dir, "jobs.db");
  const old = new Database(file);
  old.exec(`CREATE TABLE calls (activity_id TEXT PRIMARY KEY, lead_id TEXT NOT NULL, session_id TEXT,
    created_on TEXT, duration TEXT, resource_url TEXT, status TEXT NOT NULL, stage TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, transcript TEXT, raw_analysis TEXT,
    analysis TEXT, corrections TEXT, crm_response TEXT, first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, synced_at TEXT)`);
  old.close();

  const store = new JobStore(file);
  store.upsertDiscovered(call);
  store.advance("a1", STATUS.TRANSCRIBED, { transcript: "x", transcriptMeta: { words: 1 } });
  assert.deepEqual(store.get("a1").transcriptMeta, { words: 1 });
  store.close();
});

test("rediscovery fills date/duration missing from legacy import", () => {
  const store = new JobStore(":memory:");
  store.db.prepare(`INSERT INTO calls (activity_id, lead_id, status, stage, first_seen_at, updated_at)
    VALUES ('a1','lead-1','synced','synced','t','t')`).run();
  store.upsertDiscovered(call);
  const job = store.get("a1");
  assert.equal(job.createdOn, call.createdOn);
  assert.equal(job.duration, "120");
});

import { pickCall } from "../src/pipeline.js";

test("pickCall chooses the newest call long enough to audit", () => {
  const calls = [
    { activityId: "rnr", duration: "15" },
    { activityId: "short", duration: "200" },
    { activityId: "pitch", duration: "780" },
    { activityId: "old-pitch", duration: "900" }
  ];
  assert.equal(pickCall(calls, 420).activityId, "pitch");
  assert.equal(pickCall(calls, 1000), null);
  assert.equal(pickCall([{ activityId: "x", duration: null }], 420), null);
});

test("CSV cells: formulas neutralised, quotes escaped", async () => {
  const store = new JobStore(":memory:");
  store.upsertDiscovered({ ...call, activityId: "x1", leadName: '=HYPERLINK("evil")' });
  store.advance("x1", STATUS.ANALYZED, {
    analysis: { call_summary: 'Said "fees, EMI"\nthen left', customer: {}, objections: [], next_steps: [] }
  });
  const { createApp } = await import("../src/server/app.js");
  const srv = createApp(store).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const csv = await (await fetch(`http://127.0.0.1:${srv.address().port}/api/calls.csv`)).text();
  srv.close();
  assert.ok(csv.includes(`"'=HYPERLINK(""evil"")"`), "formula prefixed with ' and quotes doubled");
  assert.ok(csv.includes('"Said ""fees, EMI""\nthen left"'));
});
