
function getPath(object, dottedPath) {
  return dottedPath
    .split(".")
    .reduce((value, key) => (value == null ? undefined : value[key]), object);
}

const LABELS = {
  call_type: {
    sales_conversation: "Connected - sales conversation",
    existing_student_support: "Connected - existing student support",
    call_screening: "Not connected - call screening assistant",
    customer_unavailable: "Answered - lead not available",
    no_answer: "Not connected - no conversation",
    ivr: "Not connected - operator message",
    wrong_number: "Wrong number",
    voicemail: "Voicemail",
    other: "Connected - other",
    unknown: "Unclear"
  },
  current_status: { student: "Student", working: "Working professional", not_working: "Not working" },
  background: { tech: "Tech", non_tech: "Non-tech" },
  demo_status: {
    booked: "Booked",
    interested_not_booked: "Interested, not booked",
    declined: "Declined",
    not_discussed: "Not discussed"
  }
};

const CONVERSATION = new Set(["sales_conversation", "existing_student_support", "other"]);

function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return m ? `${m}m${rest ? ` ${rest}s` : ""}` : `${rest}s`;
}

function formatDate(value) {
  if (!value) return null;
  // LeadSquared CreatedOn is UTC "YYYY-MM-DD HH:mm:ss".
  const d = new Date(String(value).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const esc = (v) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SHORT_STATUS = {
  sales_conversation: "Connected",
  existing_student_support: "Connected (student support)",
  other: "Connected"
};

// Builds the note as structured blocks; renderNote turns them into
// HTML (LeadSquared Notes tab) or plain text.
export function noteBlocks(analysis, call) {
  const c = analysis.customer;
  const connected = CONVERSATION.has(analysis.call_type);

  const meta = [formatDate(call.createdOn), formatDuration(call.duration)].filter(Boolean).join(" · ");

  const tags = [
    connected ? SHORT_STATUS[analysis.call_type] : LABELS.call_type[analysis.call_type] ?? analysis.call_type,
    analysis.interest_level !== "unknown" &&
      `Interest: ${analysis.interest_level.toUpperCase()}${analysis.interest_reason ? ` (${analysis.interest_reason})` : ""}`,
    connected && LABELS.demo_status[analysis.demo_status] && `Demo: ${LABELS.demo_status[analysis.demo_status]}`,
    analysis.follow_up_required && "Follow-up needed"
  ].filter(Boolean);

  const blocks = [{ type: "title", text: "AI Call Summary", meta }, { type: "tags", items: tags }];

  if (!connected) {
    blocks.push({ type: "line", label: "Summary", text: analysis.call_summary });
    return blocks;
  }

  const job = c.designation ? `${c.designation}${c.company ? ` at ${c.company}` : ""}` : c.company && `at ${c.company}`;
  const profile = [
    c.name,
    LABELS.current_status[c.current_status],
    [c.qualification, c.graduation_year && `(${c.graduation_year})`].filter(Boolean).join(" "),
    LABELS.background[c.background],
    [c.experience, job].filter(Boolean).join(", "),
    c.location
  ].filter(Boolean);

  const course = [
    analysis.course_discussed && ["Course", analysis.course_discussed],
    analysis.fees_discussed && ["Fees", analysis.fees_discussed]
  ].filter(Boolean);

  blocks.push(
    { type: "line", label: "Summary", text: analysis.call_summary },
    profile.length && { type: "line", label: "Lead", text: profile.join(" · ") },
    analysis.intent !== "unknown" && { type: "line", label: "Wants", text: analysis.intent },
    analysis.goals.length && { type: "list", label: "Goals", items: analysis.goals },
    course.length && { type: "pairs", items: course },
    analysis.objections.length && {
      type: "list",
      label: "Objections",
      items: analysis.objections.map(
        (o) => `${o.concern}${o.counsellor_response ? ` → ${o.counsellor_response}` : ""} (${o.resolved ? "resolved" : "open"})`
      )
    },
    analysis.next_steps.length && {
      type: "list",
      label: "Next steps",
      items: analysis.next_steps.map(
        (s) => `${s.owner === "lead" ? "Lead" : "Counsellor"}: ${s.action}${s.when ? ` (${s.when})` : ""}`
      )
    },
    analysis.key_quotes.length && { type: "quotes", label: "Lead said", items: analysis.key_quotes }
  );

  return blocks.filter(Boolean);
}

const FOOTER = (call) => `AI-generated from call recording ${String(call.activityId).slice(0, 8)} · verify before acting`;

export function renderNote(blocks, call, format = "html") {
  if (format === "text") {
    const out = [];
    for (const b of blocks) {
      if (b.type === "title") out.push(`${b.text.toUpperCase()}${b.meta ? ` | ${b.meta}` : ""}`);
      else if (b.type === "tags") out.push(b.items.join(" | "), "");
      else if (b.type === "line") out.push(`${b.label}: ${b.text}`);
      else if (b.type === "pairs") out.push(b.items.map(([k, v]) => `${k}: ${v}`).join(" | "));
      else if (b.type === "list") out.push(`${b.label}:`, ...b.items.map((i) => `- ${i}`));
      else if (b.type === "quotes") out.push(`${b.label}:`, ...b.items.map((q) => `- "${q}"`));
    }
    out.push("", `-- ${FOOTER(call)}`);
    return out.join("\n");
  }

  const html = [];
  for (const b of blocks) {
    if (b.type === "title") {
      html.push(`<b>${esc(b.text)}</b>${b.meta ? ` &nbsp;·&nbsp; ${esc(b.meta)}` : ""}<br>`);
    } else if (b.type === "tags") {
      html.push(`${b.items.map((t, i) => (i === 0 ? `<b>${esc(t)}</b>` : esc(t))).join(" &nbsp;|&nbsp; ")}<br><br>`);
    } else if (b.type === "line") {
      html.push(`<b>${esc(b.label)}:</b> ${esc(b.text)}<br>`);
    } else if (b.type === "pairs") {
      html.push(`${b.items.map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`).join(" &nbsp;|&nbsp; ")}<br>`);
    } else if (b.type === "list") {
      html.push(`<b>${esc(b.label)}:</b><ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`);
    } else if (b.type === "quotes") {
      html.push(`<b>${esc(b.label)}:</b><ul>${b.items.map((q) => `<li><i>"${esc(q)}"</i></li>`).join("")}</ul>`);
    }
  }
  html.push(`<br><small><i>${esc(FOOTER(call))}</i></small>`);
  return html.join("");
}

// Text of the note added to the lead's Notes tab (whole-lead notes).
export function buildAuditNote(analysis, call, format = "html") {
  return renderNote(noteBlocks(analysis, call), call, format);
}

// Lead fields to update (experience, job role, company...), using the
// active CRM's field mapping. Notes go to the Notes tab separately.
export function buildLeadFields(analysis, mapping = []) {
  const fields = [];
  for (const { from, to } of mapping) {
    const value = getPath(analysis, from);
    if (value !== null && value !== undefined && String(value).trim() !== "" && value !== "unknown") {
      fields.push({ field: to, value: String(value) });
    }
  }
  return fields;
}

// Two CRM writes per call. `done` holds what already succeeded on an
// earlier attempt, and `save` records each step as soon as it succeeds,
// so a retry after a crash never adds the same note twice.
export async function syncToCrm(analysis, call, { crm, done = {}, save = () => {} }) {
  const result = { ...done };

  if (!result.leadUpdated) {
    const fields = buildLeadFields(analysis, crm.fieldMapping);
    await crm.updateLead(call.leadId, fields);
    result.leadUpdated = true;
    result.fieldsUpdated = fields.map((f) => f.field);
    save(result);
  }

  if (!result.noteId) {
    const { id } = await crm.addNote(call.leadId, buildAuditNote(analysis, call, crm.noteFormat));
    result.noteId = id ?? "created";
    result.crm = crm.id;
    save(result);
  }

  return result;
}
