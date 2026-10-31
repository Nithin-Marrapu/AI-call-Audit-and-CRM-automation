// Single source of truth for what the AI audit contains.
// The prompt, the validator and the CRM sync all read from here,
// so adding a field or an option is a one-place change.

export const CALL_TYPES = [
  "sales_conversation",
  "existing_student_support", // enrolled learner: progress, doubts, support
  "call_screening", // phone's automated assistant answered
  "customer_unavailable",
  "no_answer",
  "ivr",
  "wrong_number",
  "voicemail",
  "other",
  "unknown"
];

export const NON_SALES_CALL_TYPES = CALL_TYPES.filter(
  (type) => type !== "sales_conversation"
);

// Call types where two people actually talked.
export const CONVERSATION_CALL_TYPES = ["sales_conversation", "existing_student_support", "other"];

export const OUTCOMES = [
  "interested",
  "not_interested",
  "follow_up_required",
  "customer_unavailable",
  "no_answer",
  "wrong_number",
  "call_dropped",
  "converted",
  "not_converted",
  "unknown"
];

export const INTEREST_LEVELS = ["hot", "warm", "cold", "unknown"];

export const DEMO_STATUSES = [
  "booked",
  "interested_not_booked",
  "declined",
  "not_discussed",
  "unknown"
];

export const CURRENT_STATUSES = ["student", "working", "not_working", "unknown"];

export const BACKGROUNDS = ["tech", "non_tech", "unknown"];

export const NEXT_STEP_OWNERS = ["counsellor", "lead"];

export const CUSTOMER_FIELDS = [
  "name",
  "current_status",
  "qualification",
  "graduation_year",
  "background",
  "experience",
  "designation",
  "company",
  "location"
];

export const AUDIT_FIELDS = [
  "profiling_completed",
  "need_identified",
  "objection_handled",
  "closing_attempted"
];

// Hard rules: call_type -> forced outcome.
export const FORCED_OUTCOMES = {
  no_answer: "no_answer",
  call_screening: "no_answer",
  customer_unavailable: "customer_unavailable",
  wrong_number: "wrong_number"
};

export function emptyAudit() {
  return Object.fromEntries(AUDIT_FIELDS.map((field) => [field, false]));
}

export function emptyAnalysisTemplate() {
  return {
    call_summary: "",
    call_type: "",
    customer: Object.fromEntries(CUSTOMER_FIELDS.map((f) => [f, null])),
    intent: "",
    goals: [],
    interest_level: "unknown",
    interest_reason: null,
    course_discussed: null,
    fees_discussed: null,
    demo_status: "unknown",
    objections: [{ concern: "", counsellor_response: null, resolved: false }],
    next_steps: [{ action: "", owner: "counsellor", when: null }],
    key_quotes: [],
    outcome: "",
    follow_up_required: false,
    audit_applicable: false,
    audit: emptyAudit()
  };
}
