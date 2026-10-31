import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnalysis, quoteInTranscript } from "../src/stages/validate.js";
import { buildAuditNote } from "../src/stages/sync.js";

const call = { activityId: "a1b2c3d4-0000", leadId: "L", createdOn: "2026-10-30 05:05:00", duration: "760" };

const transcript = `[0:00] Hello, am I speaking with Ravi?
[0:03] Can you tell me your highest qualification?
[0:05] Yes. I am working as an accountant for 3 years in Hyderabad.
[0:20] I want to move into data analytics but the fee is too high for me right now.
[0:40] We have EMI options starting at 5000 per month.
[1:00] Okay, can you call me tomorrow at 6 pm? I will discuss with my father.`;

export const raw = {
  call_summary: "Counsellor pitched Data Analytics; lead is keen but worried about fees and asked for a callback.",
  call_type: "sales_conversation",
  customer: { name: "Ravi", current_status: "working", qualification: "B.Com", graduation_year: "2021",
    background: "non_tech", experience: "3 years", designation: "Accountant", company: null, location: "Hyderabad" },
  intent: "Career switch into data analytics",
  goals: ["Career switch into data analytics", "Data analyst role within 6 months"],
  interest_level: "warm",
  interest_reason: "keen, fee concern",
  course_discussed: "Data Analytics",
  fees_discussed: "EMI from 5000/month offered",
  demo_status: "interested_not_booked",
  objections: [{ concern: "Fee too high", counsellor_response: "Offered EMI from 5000/month", resolved: false }],
  next_steps: [{ action: "Call back after lead talks to father", owner: "counsellor", when: "tomorrow 6 pm" }],
  key_quotes: [
    "I want to move into data analytics but the fee is too high for me right now.",
    "Can you tell me your highest qualification?",
    "I am ready to pay today"
  ],
  outcome: "follow_up_required",
  follow_up_required: true,
  audit_applicable: true,
  audit: { profiling_completed: true, need_identified: true, objection_handled: true, closing_attempted: false }
};

test("text note: compact, no duplicates, only real lead quotes", () => {
  const { analysis, corrections } = validateAnalysis(raw, transcript);
  const note = buildAuditNote(analysis, call, "text");

  assert.match(note, /^AI CALL SUMMARY \| 30 Oct, 10:35 am · 12m 40s/);
  assert.match(note, /Connected \| Interest: WARM \(keen, fee concern\) \| Demo: Interested, not booked \| Follow-up needed/);
  assert.match(note, /Lead: Ravi · Working professional · B.Com \(2021\) · Non-tech · 3 years, Accountant · Hyderabad/);
  assert.match(note, /Wants: Career switch into data analytics/);
  assert.deepEqual(analysis.goals, ["Data analyst role within 6 months"], "goal repeating intent is dropped");
  assert.match(note, /- Fee too high → Offered EMI from 5000\/month \(open\)/);
  assert.match(note, /- Counsellor: Call back after lead talks to father \(tomorrow 6 pm\)/);
  assert.ok(note.includes('"I want to move into data analytics'));
  assert.ok(!note.includes("highest qualification?"), "counsellor question dropped");
  assert.ok(!note.includes("ready to pay today"), "invented quote dropped");
  assert.equal(corrections.filter((c) => c.field === "key_quotes").length, 2);
});

test("html note: bold labels, lists, escaped text", () => {
  const { analysis } = validateAnalysis(
    { ...raw, call_summary: "Lead asked about <script> & fees" },
    transcript
  );
  const html = buildAuditNote(analysis, call, "html");
  assert.match(html, /^<b>AI Call Summary<\/b> &nbsp;·&nbsp; 30 Oct, 10:35 am · 12m 40s<br>/);
  assert.match(html, /<b>Summary:<\/b> Lead asked about &lt;script&gt; &amp; fees<br>/);
  assert.match(html, /<b>Objections:<\/b><ul><li>Fee too high → Offered EMI/);
  assert.match(html, /<li><i>"I want to move/);
  assert.ok(!html.includes("\n"), "no raw newlines");
});

test("not-connected call: three short lines", () => {
  const { analysis } = validateAnalysis(
    { ...raw, call_type: "call_screening", call_summary: "Call screening assistant answered; no conversation." },
    "[0:00] If you record your name and reason for calling I'll see if this person is available."
  );
  const note = buildAuditNote(analysis, { ...call, duration: "32" }, "text");
  assert.equal(analysis.outcome, "no_answer");
  assert.equal(
    note,
    "AI CALL SUMMARY | 30 Oct, 10:35 am · 32s\nNot connected - call screening assistant\n\n" +
      "Summary: Call screening assistant answered; no conversation.\n\n" +
      "-- AI-generated from call recording a1b2c3d4 · verify before acting"
  );
});

test("support call can't be converted/not_converted", () => {
  const { analysis } = validateAnalysis({ ...raw, call_type: "existing_student_support", outcome: "not_converted" }, transcript);
  assert.equal(analysis.outcome, "follow_up_required");
  assert.equal(analysis.audit_applicable, false);
});

test("quoteInTranscript ignores case, punctuation and timestamps", () => {
  assert.equal(quoteInTranscript("i want to MOVE into data analytics", transcript), true);
  assert.equal(quoteInTranscript("Ravi?", transcript), false);
  assert.equal(quoteInTranscript("move data analytics into", transcript), false);
});
