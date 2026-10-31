// Accuracy is measured against human review: every call a reviewer
// approves or edits tells us which AI fields were right.

export const TRACKED_FIELDS = [
  { path: "call_type", label: "Call type" },
  { path: "outcome", label: "Outcome" },
  { path: "interest_level", label: "Interest level" },
  { path: "demo_status", label: "Demo status" },
  { path: "follow_up_required", label: "Follow-up needed" },
  { path: "customer.current_status", label: "Current status" },
  { path: "customer.qualification", label: "Qualification" },
  { path: "customer.experience", label: "Experience" },
  { path: "customer.designation", label: "Job role" },
  { path: "customer.company", label: "Company" },
  { path: "customer.location", label: "Location" },
  { path: "course_discussed", label: "Course" },
  { path: "call_summary", label: "Summary", text: true },
  { path: "next_steps", label: "Next steps", text: true }
];

const get = (obj, p) => p.split(".").reduce((v, k) => (v == null ? undefined : v[k]), obj);

const norm = (v) => {
  if (v === undefined || v === null || v === "" || v === "unknown") return "";
  if (typeof v === "object") return JSON.stringify(v).toLowerCase();
  return String(v).toLowerCase().replace(/\s+/g, " ").trim();
};

export function changedFields(ai, final) {
  return TRACKED_FIELDS.filter((f) => norm(get(ai, f.path)) !== norm(get(final, f.path))).map((f) => f.path);
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

export function computeAccuracy(store) {
  const reviewed = store.reviewed();
  const approvedOrEdited = reviewed.filter((j) => j.reviewAction !== "rejected" && j.finalAnalysis);

  const fields = TRACKED_FIELDS.map((f) => {
    let changed = 0;
    for (const j of approvedOrEdited) {
      if (norm(get(j.analysis, f.path)) !== norm(get(j.finalAnalysis, f.path))) changed++;
    }
    return {
      path: f.path,
      label: f.label,
      text: Boolean(f.text),
      reviewed: approvedOrEdited.length,
      changed,
      accuracy: pct(approvedOrEdited.length - changed, approvedOrEdited.length)
    };
  });

  const actions = { approved: 0, edited: 0, rejected: 0 };
  for (const j of reviewed) actions[j.reviewAction] = (actions[j.reviewAction] || 0) + 1;

  // Pipeline health from every analyzed call, reviewed or not.
  const analyzed = store.all().filter((j) => j.analysis);
  let corrections = 0;
  let droppedQuotes = 0;
  let lowConf = 0;
  let lowConfN = 0;
  for (const j of analyzed) {
    for (const c of j.corrections || []) {
      corrections++;
      if (c.field === "key_quotes") droppedQuotes++;
    }
    if (typeof j.transcriptMeta?.lowConfidenceShare === "number") {
      lowConf += j.transcriptMeta.lowConfidenceShare;
      lowConfN++;
    }
  }

  const byCallType = {};
  for (const j of analyzed) {
    const t = j.analysis.call_type;
    byCallType[t] = (byCallType[t] || 0) + 1;
  }

  return {
    reviewedCalls: reviewed.length,
    actions,
    approvedWithoutEdits: pct(actions.approved, approvedOrEdited.length),
    fields,
    health: {
      analyzedCalls: analyzed.length,
      ruleCorrectionsPerCall: analyzed.length ? Math.round((corrections / analyzed.length) * 10) / 10 : null,
      inventedQuotesDropped: droppedQuotes,
      avgLowConfidencePct: lowConfN ? Math.round((lowConf / lowConfN) * 1000) / 10 : null
    },
    byCallType,
    recentEdits: approvedOrEdited
      .filter((j) => j.reviewAction === "edited")
      .slice(0, 10)
      .map((j) => ({ activityId: j.activityId, leadId: j.leadId, reviewedAt: j.reviewedAt, fields: changedFields(j.analysis, j.finalAnalysis) }))
  };
}
