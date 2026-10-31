import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { leadsquared } from "../src/crm/leadsquared.js";
import { processLead } from "../src/pipeline.js";
import { JobStore } from "../src/db/jobStore.js";

// Fake LeadSquared: like the real API, no Paging = latest 25 only.
// mode "ignore-filter" pretends the account ignores ActivityEvent and
// returns nothing for it.
let mode = "normal";
const requests = [];
const leads = {
  busy: [
    ...Array.from({ length: 40 }, (_, i) => ({ Id: `wa${i}`, EventCode: 3011, EventName: "WhatsApp Message", CreatedOn: `2026-10-${String(10 + (i % 20)).padStart(2, "0")} 10:00:00`, Data: [] })),
    { Id: "out-old", EventCode: 22, EventName: "Outbound Phone Call Activity", CreatedOn: "2026-09-25 09:00:00", Data: [{ Key: "ResourceUrl", Value: "https://rec/1.mp3" }, { Key: "Duration", Value: "640" }] },
    { Id: "in-old", EventCode: 21, EventName: "Inbound Phone Call Activity", CreatedOn: "2026-09-28 09:00:00", Data: [{ Key: "ResourceUrl", Value: "https://rec/2.mp3" }, { Key: "Duration", Value: "500" }] }
  ],
  norec: [{ Id: "c1", EventCode: 22, EventName: "Outbound Phone Call Activity", CreatedOn: "2026-10-01 09:00:00", Data: [{ Key: "Duration", Value: "30" }] }],
  empty: []
};

let server, host;
before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      if (url.pathname.endsWith("Leads.GetById")) {
        const people = { busy: { FirstName: "Ravi", LastName: "Kumar" }, noname: { FirstName: "", LastName: null, Phone: "+91-98xxxxxx01" } };
        const p = people[url.searchParams.get("id")];
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify(p ? [{ ProspectID: url.searchParams.get("id"), ...p }] : []));
      }
      const b = body ? JSON.parse(body) : {};
      requests.push(b);
      let rows = [...(leads[url.searchParams.get("leadId")] || [])].sort((x, y) => (x.CreatedOn < y.CreatedOn ? 1 : -1));
      const ev = b.Parameter?.ActivityEvent;
      if (ev != null) rows = mode === "ignore-filter" ? [] : rows.filter((a) => a.EventCode === ev);
      const size = b.Paging ? Number(b.Paging.RowCount) : 25;
      const page = b.Paging ? Number(b.Paging.Offset) : 0;
      rows = rows.slice(page * size, page * size + size);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ RecordCount: rows.length, ProspectActivities: rows }));
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  host = `http://127.0.0.1:${server.address().port}/v2`;
});
after(() => server.close());

const crm = () => leadsquared.create({ credentials: { host, accessKey: "a", secretKey: "s" } });

test("finds calls older than the latest 25 activities, inbound and outbound", async () => {
  mode = "normal";
  const calls = await crm().listRecordedCalls("busy");
  assert.deepEqual(calls.map((c) => c.activityId), ["in-old", "out-old"]);
  assert.deepEqual(calls.map((c) => c.direction), ["inbound", "outbound"]);
  assert.ok(requests.every((r) => r.Paging), "always asks for paging");
});

test("falls back to all activities if the account ignores the event filter", async () => {
  mode = "ignore-filter";
  const calls = await crm().listRecordedCalls("busy");
  assert.equal(calls.length, 2);
  mode = "normal";
});

test("explains why nothing was found", async () => {
  const store = new JobStore(":memory:");
  const quiet = { step() {}, ok() {}, info() {}, error() {} };
  const c = { ...crm(), id: "leadsquared", label: "LeadSquared" };
  await assert.rejects(processLead(store, "norec", { crm: c, log: quiet }), /has 1 phone call, but none has a recording link/);
  await assert.rejects(processLead(store, "empty", { crm: c, log: quiet }), /no phone calls in the CRM/);
});

test("lead names: first + last, fallback when blank, null when no such lead", async () => {
  assert.equal(await crm().getLeadName("busy"), "Ravi Kumar");
  assert.equal(await crm().getLeadName("noname"), "+91-98xxxxxx01");
  assert.equal(await crm().getLeadName("ghost"), null);
});

test("backfill adds names to calls audited before names were stored", async () => {
  const { backfillLeadNames } = await import("../src/server/app.js");
  const store = new JobStore(":memory:");
  store.saveSettings({ crm: "leadsquared", credentials: { leadsquared: { host, accessKey: "a", secretKey: "s" } } });
  store.db.prepare(`INSERT INTO calls (activity_id, lead_id, status, stage, first_seen_at, updated_at)
    VALUES ('old1','busy','synced','synced','t','t'), ('old2','ghost','synced','synced','t','t')`).run();
  assert.equal(await backfillLeadNames(store), 1);
  assert.equal(store.get("old1").leadName, "Ravi Kumar");
  assert.equal(store.get("old2").leadName, null);
});
