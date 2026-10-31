import {
  AUDIT_FIELDS,
  BACKGROUNDS,
  CALL_TYPES,
  CONVERSATION_CALL_TYPES,
  CURRENT_STATUSES,
  CUSTOMER_FIELDS,
  DEMO_STATUSES,
  FORCED_OUTCOMES,
  INTEREST_LEVELS,
  NEXT_STEP_OWNERS,
  NON_SALES_CALL_TYPES,
  OUTCOMES,
  emptyAudit
} from "../config/schema.js";

const GREETINGS = new Set(["hello", "hi", "hey"]);

function isBlank(value) {
  if (value === undefined || value === null) return true;
  const text = String(value).trim().toLowerCase();
  return ["", "unknown", "null", "none", "n/a", "na", "not mentioned"].includes(text);
}

const text = (value) => (isBlank(value) ? null : String(value).trim());

const words = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\[\d+:\d{2}\]/g, " ")
    .replace(/[^a-z0-9ऀ-࿿]+/g, " ")
    .trim();

export function isOnlyGreetings(transcript) {
  return words(transcript)
    .split(" ")
    .filter(Boolean)
    .every((word) => GREETINGS.has(word));
}

// A quote counts only if its words appear in this order in the
// transcript (ignoring punctuation, case and timestamps).
export function quoteInTranscript(quote, transcript) {
  const q = words(quote);
  return q.split(" ").length >= 3 && ` ${words(transcript)} `.includes(` ${q} `);
}

// Normalizes model output and enforces business rules.
// Pure: never mutates the input. Every change is recorded in
// `corrections` so we can see how often the model gets overruled.
export function validateAnalysis(raw, transcript) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("AI analysis is not a JSON object.");
  }

  const corrections = [];
  const fix = (field, from, to, reason) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      corrections.push({ field, from: from ?? null, to, reason });
    }
    return to;
  };

  const oneOf = (field, value, allowed, fallback) =>
    allowed.includes(value) ? value : isBlank(value) ? fallback : fix(field, value, fallback, "invalid value");

  const list = (value) => (Array.isArray(value) ? value : []);

  // ---- customer ----
  const rawCustomer = raw.customer && typeof raw.customer === "object" ? raw.customer : {};
  const customer = {};
  for (const field of CUSTOMER_FIELDS) customer[field] = text(rawCustomer[field]);
  customer.current_status = oneOf("customer.current_status", customer.current_status, CURRENT_STATUSES, "unknown");
  customer.background = oneOf("customer.background", customer.background, BACKGROUNDS, "unknown");

  // ---- audit ----
  const rawAudit = raw.audit && typeof raw.audit === "object" ? raw.audit : {};
  const audit = {};
  for (const field of AUDIT_FIELDS) audit[field] = rawAudit[field] === true;

  // ---- objections: accept strings or objects ----
  const objections = list(raw.objections)
    .map((o) =>
      typeof o === "string"
        ? { concern: text(o), counsellor_response: null, resolved: false }
        : {
            concern: text(o?.concern),
            counsellor_response: text(o?.counsellor_response),
            resolved: o?.resolved === true
          }
    )
    .filter((o) => o.concern);

  const nextSteps = list(raw.next_steps)
    .map((s) =>
      typeof s === "string"
        ? { action: text(s), owner: "counsellor", when: null }
        : {
            action: text(s?.action),
            owner: NEXT_STEP_OWNERS.includes(s?.owner) ? s.owner : "counsellor",
            when: text(s?.when)
          }
    )
    .filter((s) => s.action);

  // ---- quotes: keep only ones really in the transcript ----
  const keyQuotes = [];
  for (const q of list(raw.key_quotes).map(text).filter(Boolean)) {
    if (!quoteInTranscript(q, transcript)) fix("key_quotes", q, null, "quote not found in transcript");
    // Questions are almost always the counsellor talking, not the lead.
    else if (q.endsWith("?")) fix("key_quotes", q, null, "question, likely counsellor");
    else keyQuotes.push(q);
  }

  // Goals that just restate the intent add noise to the note.
  const intent = text(raw.intent);
  const same = (a, b) => {
    const x = words(a), y = words(b);
    return x && y && (x === y || x.includes(y) || y.includes(x));
  };
  const goals = list(raw.goals).map(text).filter(Boolean).filter((g) => !intent || !same(g, intent));

  const analysis = {
    call_summary:
      text(raw.call_summary) ??
      fix("call_summary", raw.call_summary, "No meaningful conversation detected.", "missing"),
    call_type: CALL_TYPES.includes(raw.call_type)
      ? raw.call_type
      : fix("call_type", raw.call_type, "unknown", "invalid value"),
    customer,
    intent: intent ?? "unknown",
    goals,
    interest_level: oneOf("interest_level", raw.interest_level, INTEREST_LEVELS, "unknown"),
    interest_reason: text(raw.interest_reason),
    course_discussed: text(raw.course_discussed),
    fees_discussed: text(raw.fees_discussed),
    demo_status: oneOf("demo_status", raw.demo_status, DEMO_STATUSES, "unknown"),
    objections,
    next_steps: nextSteps,
    key_quotes: keyQuotes.slice(0, 2),
    outcome: OUTCOMES.includes(raw.outcome)
      ? raw.outcome
      : fix("outcome", raw.outcome, "unknown", "invalid value"),
    follow_up_required: raw.follow_up_required === true,
    audit_applicable: raw.audit_applicable === true,
    audit
  };

  // Rule: transcript is only greetings -> nobody really answered.
  if (isOnlyGreetings(transcript)) {
    analysis.call_type = fix("call_type", analysis.call_type, "no_answer", "only greetings in transcript");
    analysis.call_summary = "Repeated greetings with no meaningful conversation.";
  }

  // Rule: some call types force the outcome.
  const forced = FORCED_OUTCOMES[analysis.call_type];
  if (forced) {
    analysis.outcome = fix("outcome", analysis.outcome, forced, `forced by call_type=${analysis.call_type}`);
  }

  // Rule: no conversation -> no lead details, interest or next steps.
  if (!CONVERSATION_CALL_TYPES.includes(analysis.call_type)) {
    analysis.intent = "unknown";
    analysis.interest_level = fix("interest_level", analysis.interest_level, "unknown", "no conversation");
    analysis.demo_status = fix("demo_status", analysis.demo_status, "unknown", "no conversation");
    analysis.goals = fix("goals", analysis.goals, [], "no conversation");
    analysis.objections = fix("objections", analysis.objections, [], "no conversation");
    analysis.next_steps = fix("next_steps", analysis.next_steps, [], "no conversation");
    analysis.key_quotes = [];
  }

  if (analysis.call_type === "no_answer" || analysis.call_type === "call_screening") {
    analysis.follow_up_required = fix("follow_up_required", analysis.follow_up_required, false, "no conversation");
  }

  // Rule: only real sales conversations get a sales audit.
  if (NON_SALES_CALL_TYPES.includes(analysis.call_type)) {
    analysis.audit_applicable = fix("audit_applicable", analysis.audit_applicable, false, "not a sales conversation");
    analysis.audit = fix("audit", analysis.audit, emptyAudit(), "not a sales conversation");
  }

  // Rule: an enrolled student cannot be "converted" or "not_converted".
  if (
    analysis.call_type === "existing_student_support" &&
    ["converted", "not_converted", "interested", "not_interested"].includes(analysis.outcome)
  ) {
    analysis.outcome = fix(
      "outcome",
      analysis.outcome,
      analysis.follow_up_required ? "follow_up_required" : "unknown",
      "sales outcome on a support call"
    );
  }

  return { analysis, corrections };
}
