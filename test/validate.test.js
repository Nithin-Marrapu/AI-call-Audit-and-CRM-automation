import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnalysis, isOnlyGreetings } from "../src/stages/validate.js";
import { extractJson } from "../src/stages/analyze.js";

const salesCall = {
  call_summary: "Discussed data science course; customer wants EMI options.",
  call_type: "sales_conversation",
  customer: { name: "Ravi", qualification: "B.Tech", experience: "2 years", designation: "unknown", company: "" },
  intent: "course enquiry",
  objections: ["price"],
  outcome: "interested",
  follow_up_required: true,
  audit_applicable: true,
  audit: { profiling_completed: true, need_identified: true, objection_handled: false, closing_attempted: "yes" }
};

test("keeps a valid sales call and blanks unknown customer fields", () => {
  const { analysis, corrections } = validateAnalysis(salesCall, "long real transcript about the course");
  assert.equal(analysis.call_type, "sales_conversation");
  assert.equal(analysis.outcome, "interested");
  assert.equal(analysis.customer.designation, null);
  assert.equal(analysis.customer.company, null);
  assert.equal(analysis.customer.experience, "2 years");
  assert.equal(analysis.audit.closing_attempted, false, "non-boolean true is not true");
  assert.equal(analysis.audit_applicable, true);
  assert.deepEqual(corrections, []);
});

test("does not mutate the model output", () => {
  const input = structuredClone(salesCall);
  validateAnalysis(input, "hello");
  assert.deepEqual(input, salesCall);
});

test("greeting-only transcript becomes no_answer with no audit", () => {
  const { analysis, corrections } = validateAnalysis(salesCall, "Hello? Hello... hi");
  assert.equal(analysis.call_type, "no_answer");
  assert.equal(analysis.outcome, "no_answer");
  assert.equal(analysis.follow_up_required, false);
  assert.equal(analysis.audit_applicable, false);
  assert.ok(Object.values(analysis.audit).every((v) => v === false));
  assert.ok(corrections.some((c) => c.field === "call_type"));
});

test("forced outcomes per call type", () => {
  const { analysis } = validateAnalysis(
    { ...salesCall, call_type: "wrong_number", outcome: "interested" },
    "sorry wrong number, I am not Ravi"
  );
  assert.equal(analysis.outcome, "wrong_number");
  assert.equal(analysis.audit_applicable, false);
});

test("invalid enum values fall back to unknown and are recorded", () => {
  const { analysis, corrections } = validateAnalysis(
    { ...salesCall, call_type: "sales", outcome: "maybe" },
    "a real conversation here"
  );
  assert.equal(analysis.call_type, "unknown");
  assert.equal(analysis.outcome, "unknown");
  assert.equal(analysis.audit_applicable, false);
  assert.equal(corrections.filter((c) => c.reason === "invalid value").length, 2);
});

test("rejects non-objects", () => {
  assert.throws(() => validateAnalysis(null, ""));
  assert.throws(() => validateAnalysis([], ""));
});

test("isOnlyGreetings", () => {
  assert.equal(isOnlyGreetings(""), true);
  assert.equal(isOnlyGreetings("Hello hello HI!"), true);
  assert.equal(isOnlyGreetings("hello, is this Ravi?"), false);
});

test("extractJson handles thinking text, braces in strings, and truncation", () => {
  assert.deepEqual(extractJson('Sure!\n{"a": "x } y", "b": {"c": 1}} trailing'), { a: "x } y", b: { c: 1 } });
  assert.throws(() => extractJson('{"a": {"b": 1}'), /Incomplete/);
  assert.throws(() => extractJson("no json"), /No JSON/);
});

import { segmentsToTranscript, transcriptStats } from "../src/stages/transcribe.js";

test("timestamped transcript and confidence stats", () => {
  const segs = [
    { start: 0, end: 2.5, text: "Hello, am I speaking with Ravi?", avg_logprob: -0.3 },
    { start: 65.2, end: 70, text: "Yes, tell me about EMI.", avg_logprob: -1.4 }
  ];
  assert.equal(segmentsToTranscript(segs), "[0:00] Hello, am I speaking with Ravi?\n[1:05] Yes, tell me about EMI.");
  assert.deepEqual(transcriptStats(segs), { segments: 2, words: 11, avgLogprob: -0.85, lowConfidenceShare: 0.5 });
  assert.equal(transcriptStats([]).words, 0);
});

test("timestamps don't break greeting detection", () => {
  assert.equal(isOnlyGreetings("[0:00] Hello?\n[0:03] Hello hello"), true);
});
