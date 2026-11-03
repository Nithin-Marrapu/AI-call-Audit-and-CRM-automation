import { test } from "node:test";
import assert from "node:assert/strict";
import { JobStore } from "../src/db/jobStore.js";
import { DISPOSITION_DEFAULTS, DispositionStore, applyOutcome, decideOutcome, overwriteRule, resolveOutcome } from "../src/disposition.js";
import { Watcher } from "../src/watcher.js";
import { extractCalls } from "../src/stages/discover.js";

const V = DISPOSITION_DEFAULTS.values;
const on = { ...DISPOSITION_DEFAULTS, enabled: true };

test("outcome from the dialer: answered, RNR, invalid, unsure", () => {
  assert.deepEqual(
    [
      decideOutcome({ dialerStatus: "Answered", callType: "Complete", duration: "69" }),
      decideOutcome({ dialerStatus: "NotAnswered", duration: "0" }),
      decideOutcome({ dialerStatus: "Missed" }),
      decideOutcome({ dialerStatus: "Busy" }),
      decideOutcome({ dialerStatus: "Invalid Number" }),
      decideOutcome({ dialerStatus: "Answered", duration: "8" }),
      decideOutcome({ dialerStatus: "Something new", duration: "40" })
    ].map((d) => [d.outcome, d.confidence]),
    [
      ["answered", "high"],
      ["rnr", "high"],
      ["rnr", "high"],
      ["rnr", "high"],
      ["invalid", "high"],
      ["answered", "low"],
      [null, "low"]
    ]
  );
});

test("AI disagreeing with the dialer sends the call to a person", () => {
  const call = { dialerStatus: "Answered", duration: "600" };
  assert.equal(decideOutcome(call, { call_type: "sales_conversation" }).confidence, "high");
  assert.deepEqual(Object.values(decideOutcome(call, { call_type: "wrong_number" })).slice(0, 2), ["invalid", "low"]);
  assert.equal(decideOutcome(call, { call_type: "ivr" }).confidence, "low");
});

test("never overwrites a person's value, except RNR -> answered", () => {
  assert.equal(overwriteRule("", "rnr", V), "write");
  assert.equal(overwriteRule(null, "answered", V), "write");
  assert.equal(overwriteRule("No (RNR)", "answered", V), "write");
  assert.equal(overwriteRule("Yes", "rnr", V), "keep");
  assert.equal(overwriteRule("Number does not exist", "answered", V), "keep");
  assert.equal(overwriteRule("Yes", "answered", V), "same");
});

function fakeCrm(leadValues = {}) {
  const writes = [];
  return {
    writes,
    id: "leadsquared",
    label: "LeadSquared",
    async getLeadValue(leadId) {
      return leadValues[leadId] ?? null;
    },
    async updateLead(leadId, fields) {
      writes.push({ leadId, ...fields[0] });
      leadValues[leadId] = fields[0].value;
    }
  };
}

test("confident outcomes are written once; unsure ones wait; a person resolves them", async () => {
  const dstore = new DispositionStore(new JobStore(":memory:").db);
  const crm = fakeCrm({ L2: "Yes" });

  const a = await applyOutcome(dstore, crm, on, { activityId: "a1", leadId: "L1", dialerStatus: "NotAnswered", duration: "0" });
  assert.equal(a.state, "written");
  assert.deepEqual(crm.writes, [{ leadId: "L1", field: "mx_Phone_Answered", value: "No (RNR)" }]);
  await applyOutcome(dstore, crm, on, { activityId: "a1", leadId: "L1", dialerStatus: "NotAnswered" });
  assert.equal(crm.writes.length, 1, "same call never written twice");

  const kept = await applyOutcome(dstore, crm, on, { activityId: "a2", leadId: "L2", dialerStatus: "Missed" });
  assert.equal(kept.state, "kept", "a person's Yes is not replaced by RNR");

  const unsure = await applyOutcome(dstore, crm, on, { activityId: "a3", leadId: "L3", dialerStatus: "Answered", duration: "6" });
  assert.equal(unsure.state, "pending");
  assert.equal(crm.writes.length, 1);

  const done = await resolveOutcome(dstore, crm, on, "a3", "invalid");
  assert.equal(done.state, "written");
  assert.equal(done.byPerson, true);
  assert.deepEqual(crm.writes.at(-1), { leadId: "L3", field: "mx_Phone_Answered", value: "Number does not exist" });
  assert.equal((await resolveOutcome(dstore, crm, on, "a2", "skip")).state, "skipped");
});

test("switched off: decisions are recorded but nothing is written", async () => {
  const dstore = new DispositionStore(new JobStore(":memory:").db);
  const crm = fakeCrm();
  const d = await applyOutcome(dstore, crm, DISPOSITION_DEFAULTS, { activityId: "x", leadId: "L1", dialerStatus: "Answered", duration: "90" });
  assert.equal(d.state, "off");
  assert.equal(crm.writes.length, 0);
});

test("watcher fills the outcome of short and unanswered calls", async () => {
  const NOW = Date.parse("2026-11-03T12:00:00Z");
  const ts = (min) => new Date(NOW - min * 60000).toISOString().slice(0, 19).replace("T", " ");
  const store = new JobStore(":memory:");
  store.saveSettings({ crm: "leadsquared", minCallMinutes: 7, disposition: { enabled: true } });
  const crm = {
    ...fakeCrm(),
    async listCallsSince() {
      return [
        { activityId: "rnr", leadId: "L1", createdOn: ts(5) },
        { activityId: "short", leadId: "L2", createdOn: ts(5) },
        { activityId: "late", leadId: "L3", createdOn: ts(2) }
      ];
    },
    async listCalls(leadId) {
      return {
        L1: [{ activityId: "rnr", leadId: "L1", dialerStatus: "NotAnswered", duration: "0" }],
        L2: [{ activityId: "short", leadId: "L2", dialerStatus: "Answered", duration: "95", resourceUrl: "https://r" }],
        L3: [{ activityId: "late", leadId: "L3", dialerStatus: "Answered", duration: "700" }]
      }[leadId];
    },
    async getLeadName() {
      return null;
    }
  };
  const queue = { add: () => ({ id: "1" }) };
  const w = new Watcher(store, queue, { now: () => NOW, crmFor: () => crm });
  await w.check();
  assert.deepEqual(crm.writes.map((x) => [x.leadId, x.value]), [["L1", "No (RNR)"], ["L2", "Yes"]]);
  assert.equal(w.status().today.outcomes, 2);
  assert.equal(w.dispositions.get("late"), null, "answered, recording not there yet: wait");
});

test("dialer status is read from LeadSquared call activities", () => {
  const [c] = extractCalls(
    [{ Id: "1", EventCode: 22, CreatedOn: "2026-10-01 07:36:36", ActivityFields: { Status: "Answered" }, Data: [{ Key: "Duration", Value: "69" }, { Key: "CallType", Value: "Complete" }] }],
    "L1"
  );
  assert.equal(c.dialerStatus, "Answered");
  assert.equal(c.resourceUrl, null);
});

test("watcher dry run: with auto-fill off it records outcomes but writes nothing", async () => {
  const NOW = Date.parse("2026-11-03T12:00:00Z");
  const store = new JobStore(":memory:");
  store.saveSettings({ crm: "leadsquared", minCallMinutes: 7 });
  const crm = {
    ...fakeCrm(),
    listCallsSince: async () => [{ activityId: "r1", leadId: "L1", createdOn: "2026-11-03 11:55:00" }],
    listCalls: async () => [{ activityId: "r1", leadId: "L1", dialerStatus: "NotAnswered", duration: "0" }],
    getLeadName: async () => "Test Lead"
  };
  const w = new Watcher(store, { add: () => ({ id: "1" }) }, { now: () => NOW, crmFor: () => crm });
  await w.check();
  assert.equal(crm.writes.length, 0);
  const d = w.dispositions.get("r1");
  assert.deepEqual([d.state, d.outcome, d.leadName], ["off", "rnr", "Test Lead"]);
});
