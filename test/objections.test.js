import { test } from "node:test";
import assert from "node:assert/strict";
import { themeOf, topObjections } from "../src/objections.js";

test("themeOf groups differently worded objections", () => {
  assert.equal(themeOf("Fee too high"), "fees");
  assert.equal(themeOf("Expected around fifty thousand"), "fees");
  assert.equal(themeOf("Nine months is too long with a small child"), "time");
  assert.equal(themeOf("Parents must approve the fee"), "family", "who decides beats what it's about");
  assert.equal(themeOf("Worried about keeping up without a tech background"), "difficulty");
  assert.equal(themeOf("Is the certificate recognised?"), "trust");
  assert.equal(themeOf("Wants a placement guarantee"), "placement");
  assert.equal(themeOf("Something unusual"), "other");
  assert.equal(themeOf("I work night shifts"), "other", "no false match on 'work'");
});

test("topObjections counts each theme once per call, recent calls only", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  const call = (createdOn, concerns) => ({ createdOn, analysis: { objections: concerns.map((c) => ({ concern: c })) } });
  const r = topObjections(
    [
      call("2026-10-30 10:00:00", ["Fee too high", "Can't afford EMI", "Too busy"]),
      call("2026-10-29 10:00:00", ["Price is expensive"]),
      call("2026-10-28 10:00:00", ["Something unusual"]),
      call("2026-10-01 10:00:00", ["Fee too high"]), // older than 7 days
      { createdOn: "2026-10-30 10:00:00", analysis: { objections: [] } }
    ],
    { days: 7, now }
  );
  assert.equal(r.callsWithObjections, 3);
  assert.deepEqual(r.themes.map((t) => [t.id, t.count]), [["fees", 2], ["time", 1], ["other", 1]]);
  assert.equal(r.themes[0].search, "fee");
  assert.equal(r.themes[0].example, "Fee too high");
});
