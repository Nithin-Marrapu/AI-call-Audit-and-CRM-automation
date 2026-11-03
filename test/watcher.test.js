import { test } from "node:test";
import assert from "node:assert/strict";
import { JobStore } from "../src/db/jobStore.js";
import { Watcher } from "../src/watcher.js";
import { fetchCallsSince, lsqDate } from "../src/crm/leadsquared.js";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const ago = (min) => lsqDate(NOW - min * 60000);

// A fake CRM: `recent` is what the bulk "calls since" API returns,
// `recorded` is what listRecordedCalls(lead) returns (calls with audio).
function fakeCrm({ recent = [], recorded = {} } = {}) {
  const asked = [];
  return {
    asked,
    crm: {
      id: "leadsquared",
      label: "LeadSquared",
      async listCallsSince(from, to) {
        asked.push({ from: from.getTime(), to: to.getTime() });
        return recent;
      },
      async listRecordedCalls(leadId) {
        return recorded[leadId] || [];
      }
    }
  };
}

function fakeQueue() {
  const added = [];
  return { added, add: (label, meta) => (added.push({ label, ...meta }), { id: String(added.length), label }) };
}

function setup(crmParts, settings = {}) {
  const store = new JobStore(":memory:");
  store.saveSettings({ crm: "leadsquared", minCallMinutes: 7, ...settings });
  const queue = fakeQueue();
  const { crm, asked } = fakeCrm(crmParts);
  let now = NOW;
  const watcher = new Watcher(store, queue, { now: () => now, crmFor: () => crm });
  return { store, queue, watcher, asked, setNow: (t) => (now = t) };
}

test("queues only new calls of 7+ minutes that have a recording", async () => {
  const { queue, watcher } = setup({
    recent: [
      { activityId: "long", leadId: "L1", createdOn: ago(12) },
      { activityId: "short", leadId: "L1", createdOn: ago(8) },
      { activityId: "pending", leadId: "L2", createdOn: ago(3) },
      { activityId: "norec", leadId: "L2", createdOn: ago(90) }
    ],
    recorded: {
      L1: [
        { activityId: "long", leadId: "L1", duration: "640" },
        { activityId: "short", leadId: "L1", duration: "45" }
      ],
      L2: []
    }
  });

  const r = await watcher.check();
  assert.deepEqual(queue.added.map((j) => j.activityId), ["long"]);
  assert.equal(queue.added[0].auto, true);
  assert.equal(r.queued, 1);
  const t = watcher.status().today;
  assert.deepEqual([t.found, t.queued, t.short, t.noRecording], [4, 1, 1, 1]);
});

test("never queues the same call twice, and retries a call whose recording arrives late", async () => {
  const parts = {
    recent: [{ activityId: "late", leadId: "L1", createdOn: ago(2) }],
    recorded: { L1: [] }
  };
  const { queue, watcher } = setup(parts);

  await watcher.check();
  assert.equal(queue.added.length, 0, "no recording yet");

  parts.recorded.L1 = [{ activityId: "late", leadId: "L1", duration: "900" }];
  await watcher.check();
  await watcher.check();
  assert.deepEqual(queue.added.map((j) => j.activityId), ["late"]);
});

test("skips calls that are already in the app", async () => {
  const { store, queue, watcher } = setup({
    recent: [{ activityId: "done", leadId: "L1", createdOn: ago(20) }],
    recorded: { L1: [{ activityId: "done", leadId: "L1", duration: "900" }] }
  });
  store.upsertDiscovered({ activityId: "done", leadId: "L1", createdOn: ago(20), duration: "900", crm: "leadsquared" });
  await watcher.check();
  assert.equal(queue.added.length, 0);
  assert.equal(watcher.status().today.already, 1);
});

test("looks back from the last check with an overlap, and moves the cursor forward", async () => {
  const { store, watcher, asked, setNow } = setup({}, { watcherCursor: new Date(NOW - 3 * 60000).toISOString() });
  await watcher.check();
  assert.equal(asked[0].to, NOW);
  assert.equal(asked[0].from, NOW - 18 * 60000, "3 min since last check + 15 min overlap");
  assert.equal(store.getSettings().watcherCursor, new Date(NOW).toISOString());

  setNow(NOW + 3 * 60000);
  await watcher.check();
  assert.equal(asked[1].from, NOW - 15 * 60000);
});

test("a failed check keeps the cursor, so no calls are missed", async () => {
  const { store, watcher } = setup({}, { watcherCursor: "2026-11-03T11:50:00.000Z" });
  watcher.crmFor = () => ({
    label: "LeadSquared",
    listCallsSince: async () => {
      throw new Error("HTTP 429");
    }
  });
  await assert.rejects(watcher.check(), /429/);
  assert.equal(store.getSettings().watcherCursor, "2026-11-03T11:50:00.000Z");
  assert.match(watcher.status().lastError, /429/);
  assert.equal(watcher.status().events[0].type, "error");
});

test("a CRM that can't list new calls gives a clear error", async () => {
  const { watcher } = setup({});
  watcher.crmFor = () => ({ label: "Demo CRM" });
  await assert.rejects(watcher.check(), /Demo CRM can't list new calls/);
});

test("turning on starts from the last 30 minutes; settings validate", () => {
  const { store, watcher } = setup({});
  watcher.check = async () => ({});
  watcher.setConfig({ enabled: true, intervalMinutes: 5 });
  assert.equal(store.getSettings().watcherCursor, new Date(NOW - 30 * 60000).toISOString());
  assert.equal(watcher.status().intervalMinutes, 5);
  assert.throws(() => watcher.setConfig({ intervalMinutes: 0 }), /1-60/);
  watcher.setConfig({ enabled: false });
  assert.equal(watcher.status().running, false);
});

test("LeadSquared bulk API: pages, both call codes, ids mapped", async () => {
  const calls = [];
  const client = {
    async getActivitiesByEvent({ activityEvent, from, to, page, pageSize }) {
      calls.push({ activityEvent, from, to, page });
      if (Number(activityEvent) !== 22) return { List: [{ ProspectActivityId: "in1", RelatedProspectId: "L9", CreatedOn: "2026-11-03 11:58:00" }] };
      const all = Array.from({ length: 250 }, (_, i) => ({ ProspectActivityId: `o${i}`, RelatedProspectId: "L1", CreatedOn: "2026-11-03 11:50:00" }));
      return { List: all.slice((page - 1) * pageSize, page * pageSize) };
    }
  };
  const found = await fetchCallsSince(client, new Date("2026-11-03T11:00:00Z"), new Date("2026-11-03T12:00:00Z"));
  assert.equal(found.length, 251);
  assert.deepEqual(found[0], { activityId: "in1", leadId: "L9", createdOn: "2026-11-03 11:58:00" });
  assert.equal(calls[0].from, "2026-11-03 11:00:00");
  assert.deepEqual(calls.filter((c) => Number(c.activityEvent) === 22).map((c) => c.page), [1, 2]);
});

test("checking past calls looks further back once, queues at most 10, keeps the cursor", async () => {
  const recent = Array.from({ length: 12 }, (_, i) => ({ activityId: `p${i}`, leadId: "L1", createdOn: ago(600 + i) }));
  const { store, queue, watcher, asked } = setup(
    { recent, recorded: { L1: recent.map((r) => ({ activityId: r.activityId, leadId: "L1", duration: "800" })) } },
    { watcherCursor: new Date(NOW).toISOString() }
  );
  const r = await watcher.check({ lookbackHours: 24 });
  assert.equal(asked[0].from, NOW - 24 * 3600000);
  assert.deepEqual([r.queued, r.left], [10, 2]);
  assert.equal(store.getSettings().watcherCursor, new Date(NOW).toISOString());

  await watcher.check({ lookbackHours: 24 });
  assert.equal(queue.added.length, 12, "the 2 left over are queued next time");
});
