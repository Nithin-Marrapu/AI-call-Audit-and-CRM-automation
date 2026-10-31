import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../hooks.js";
import { when, label } from "../format.js";
import { DurationBar, StatusChip, ErrorNote } from "../components/bits.jsx";

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const toSeconds = (t) => {
  const [m, sec] = String(t).split(":").map(Number);
  return Number.isFinite(m) && Number.isFinite(sec) ? m * 60 + sec : null;
};

// Transcript lines. With a recording, each line is a button that plays
// the call from that moment, and the line being spoken is marked.
function Transcript({ text, quotes, audioSrc }) {
  const audio = useRef(null);
  const [now, setNow] = useState(-1);
  const qs = (quotes || []).map(words).filter(Boolean);
  const lines = useMemo(
    () =>
      String(text || "")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const m = l.match(/^\[(\d+:\d{2})\]\s*(.*)$/);
          return m ? { t: m[1], at: toSeconds(m[1]), text: m[2] } : { t: "", at: null, text: l };
        }),
    [text]
  );

  // Index of the line whose start time is the latest one before `now`.
  let current = -1;
  if (now >= 0) {
    for (let i = 0; i < lines.length; i++) if (lines[i].at != null && lines[i].at <= now) current = i;
  }

  useEffect(() => {
    if (current < 0) return;
    document.getElementById(`line-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const playFrom = (at) => {
    const a = audio.current;
    if (!a || at == null) return;
    a.currentTime = at;
    a.play();
  };

  return (
    <>
      {audioSrc && (
        <div className="player">
          <audio
            ref={audio}
            controls
            preload="metadata"
            src={audioSrc}
            onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
            onEnded={() => setNow(-1)}
          />
          <p className="hint">Click a line to play the call from there.</p>
        </div>
      )}
      <ol className="transcript">
        {lines.map((l, i) => {
          const w = words(l.text);
          const hit = w.length > 8 && qs.some((q) => w.includes(q) || q.includes(w));
          const cls = [hit && "is-quoted", i === current && "is-now"].filter(Boolean).join(" ");
          return (
            <li key={i} id={`line-${i}`} className={cls}>
              {audioSrc && l.at != null ? (
                <button type="button" className="line-btn" onClick={() => playFrom(l.at)} aria-label={`Play from ${l.t}`}>
                  <time>{l.t}</time>
                  <span>{l.text}</span>
                </button>
              ) : (
                <>
                  <time>{l.t}</time>
                  <span>{l.text}</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Select({ value, options, onChange, id }) {
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {label(o)}
        </option>
      ))}
    </select>
  );
}

function Field({ id, text, children, wide }) {
  return (
    <div className={`field ${wide ? "field-wide" : ""}`}>
      <label htmlFor={id}>{text}</label>
      {children}
    </div>
  );
}

// Lets a reviewer fix the AI's analysis before it goes to the CRM.
function Editor({ draft, setDraft, schema }) {
  const set = (path, value) =>
    setDraft((d) => {
      const next = structuredClone(d);
      const keys = path.split(".");
      let o = next;
      for (const k of keys.slice(0, -1)) o = o[k] ??= {};
      o[keys.at(-1)] = value === "" ? null : value;
      return next;
    });
  const listSet = (key, i, prop, value) =>
    setDraft((d) => {
      const next = structuredClone(d);
      next[key][i][prop] = value;
      return next;
    });
  const listAdd = (key, row) => setDraft((d) => ({ ...d, [key]: [...d[key], row] }));
  const listDel = (key, i) => setDraft((d) => ({ ...d, [key]: d[key].filter((_, j) => j !== i) }));
  const c = draft.customer || {};

  return (
    <form className="editor" onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>Call</legend>
        <Field id="e-sum" text="Summary" wide>
          <textarea id="e-sum" rows={3} value={draft.call_summary ?? ""} onChange={(e) => set("call_summary", e.target.value)} />
        </Field>
        <Field id="e-type" text="Call type">
          <Select id="e-type" value={draft.call_type} options={schema.callTypes} onChange={(v) => set("call_type", v)} />
        </Field>
        <Field id="e-out" text="Outcome">
          <Select id="e-out" value={draft.outcome} options={schema.outcomes} onChange={(v) => set("outcome", v)} />
        </Field>
        <Field id="e-int" text="Interest">
          <Select id="e-int" value={draft.interest_level} options={schema.interestLevels} onChange={(v) => set("interest_level", v)} />
        </Field>
        <Field id="e-why" text="Why">
          <input id="e-why" value={draft.interest_reason ?? ""} onChange={(e) => set("interest_reason", e.target.value)} />
        </Field>
        <Field id="e-demo" text="Demo">
          <Select id="e-demo" value={draft.demo_status} options={schema.demoStatuses} onChange={(v) => set("demo_status", v)} />
        </Field>
        <div className="field check">
          <input
            id="e-fu"
            type="checkbox"
            checked={draft.follow_up_required === true}
            onChange={(e) => set("follow_up_required", e.target.checked)}
          />
          <label htmlFor="e-fu">Follow-up needed</label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Lead</legend>
        <Field id="e-cs" text="Current status">
          <Select id="e-cs" value={c.current_status} options={schema.currentStatuses} onChange={(v) => set("customer.current_status", v)} />
        </Field>
        <Field id="e-bg" text="Background">
          <Select id="e-bg" value={c.background} options={schema.backgrounds} onChange={(v) => set("customer.background", v)} />
        </Field>
        {[
          ["name", "Name"],
          ["qualification", "Qualification"],
          ["graduation_year", "Graduation year"],
          ["experience", "Experience"],
          ["designation", "Job role"],
          ["company", "Company"],
          ["location", "Location"]
        ].map(([k, t]) => (
          <Field key={k} id={`e-c-${k}`} text={t}>
            <input id={`e-c-${k}`} value={c[k] ?? ""} onChange={(e) => set(`customer.${k}`, e.target.value)} />
          </Field>
        ))}
      </fieldset>

      <fieldset>
        <legend>Interest</legend>
        <Field id="e-intent" text="Wants" wide>
          <input id="e-intent" value={draft.intent === "unknown" ? "" : draft.intent ?? ""} onChange={(e) => set("intent", e.target.value || "unknown")} />
        </Field>
        <Field id="e-course" text="Course">
          <input id="e-course" value={draft.course_discussed ?? ""} onChange={(e) => set("course_discussed", e.target.value)} />
        </Field>
        <Field id="e-fees" text="Fees">
          <input id="e-fees" value={draft.fees_discussed ?? ""} onChange={(e) => set("fees_discussed", e.target.value)} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Objections</legend>
        {draft.objections.map((o, i) => (
          <div className="row-edit row-stack" key={i}>
            <input aria-label="Concern" placeholder="Concern" value={o.concern ?? ""} onChange={(e) => listSet("objections", i, "concern", e.target.value)} />
            <input
              aria-label="Counsellor's answer"
              placeholder="Counsellor's answer"
              value={o.counsellor_response ?? ""}
              onChange={(e) => listSet("objections", i, "counsellor_response", e.target.value || null)}
            />
            <label className="inline-check">
              <input type="checkbox" checked={o.resolved} onChange={(e) => listSet("objections", i, "resolved", e.target.checked)} />
              Resolved
            </label>
            <button type="button" className="btn-quiet" onClick={() => listDel("objections", i)} aria-label="Remove objection">
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn-quiet" onClick={() => listAdd("objections", { concern: "", counsellor_response: null, resolved: false })}>
          Add objection
        </button>
      </fieldset>

      <fieldset>
        <legend>Next steps</legend>
        {draft.next_steps.map((s, i) => (
          <div className="row-edit row-steps" key={i}>
            <input aria-label="Action" placeholder="Action" value={s.action ?? ""} onChange={(e) => listSet("next_steps", i, "action", e.target.value)} />
            <select aria-label="Who" value={s.owner} onChange={(e) => listSet("next_steps", i, "owner", e.target.value)}>
              <option value="counsellor">Counsellor</option>
              <option value="lead">Lead</option>
            </select>
            <input aria-label="When" placeholder="When" value={s.when ?? ""} onChange={(e) => listSet("next_steps", i, "when", e.target.value || null)} />
            <button type="button" className="btn-quiet" onClick={() => listDel("next_steps", i)} aria-label="Remove step">
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn-quiet" onClick={() => listAdd("next_steps", { action: "", owner: "counsellor", when: null })}>
          Add next step
        </button>
      </fieldset>

      {draft.key_quotes.length > 0 && (
        <fieldset>
          <legend>Lead said</legend>
          {draft.key_quotes.map((q, i) => (
            <div className="row-edit" key={i}>
              <q className="quote">{q}</q>
              <button type="button" className="btn-quiet" onClick={() => listDel("key_quotes", i)}>
                Remove
              </button>
            </div>
          ))}
        </fieldset>
      )}
    </form>
  );
}

export default function CallDetail() {
  const { id } = useParams();
  const { data: job, error, reload } = useApi(`/calls/${encodeURIComponent(id)}`, { poll: 5000 });
  const { data: schema } = useApi("/schema");
  const { data: settings } = useApi("/settings");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [showChecks, setShowChecks] = useState(false);

  const analysis = job?.finalAnalysis ?? job?.analysis;
  const inReview = job?.status === "review";
  const edited = useMemo(() => draft && JSON.stringify(draft) !== JSON.stringify(job?.analysis), [draft, job]);

  async function act(path, body) {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/calls/${encodeURIComponent(id)}/${path}`, body);
      setDraft(null);
      await reload();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="page"><ErrorNote>{error}</ErrorNote><Link to="/">Back to calls</Link></div>;
  if (!job) return <div className="page"><p className="muted">Loading…</p></div>;

  const s = job.summary;
  return (
    <div className="page page-wide">
      <Link className="back" to={inReview ? "/review" : "/"}>
        {inReview ? "Review" : "Calls"}
      </Link>

      <header className="detail-head">
        <div>
          <h1>{s.leadName || job.leadId}</h1>
          <p className="lede">
            {when(job.createdOn)}, {s.callType ? label(s.callType).toLowerCase() : "not analyzed yet"}
            {job.crm ? `, ${{ demo: "from Demo CRM", leadsquared: "from LeadSquared", upload: "uploaded" }[job.crm] ?? `from ${job.crm}`}` : ""}
          </p>
          <div className="detail-meta">
            <DurationBar seconds={job.duration} minMinutes={settings?.minCallMinutes ?? 7} />
            <StatusChip status={job.status} />
            {job.reviewAction && <span className="muted">{label(job.reviewAction)} by reviewer</span>}
          </div>
        </div>

        <div className="actions">
          {inReview && !draft && (
            <button className="btn" onClick={() => setDraft(structuredClone(job.analysis))} disabled={busy}>
              Edit
            </button>
          )}
          {inReview && draft && (
            <button className="btn" onClick={() => setDraft(null)} disabled={busy}>
              Discard edits
            </button>
          )}
          {inReview && (
            <>
              <button className="btn btn-danger" onClick={() => act("reject")} disabled={busy}>
                Reject
              </button>
              <button className="btn btn-primary" onClick={() => act("approve", edited ? { analysis: draft } : {})} disabled={busy}>
                {busy ? "Sending…" : edited ? "Approve with edits" : "Approve and send"}
              </button>
            </>
          )}
          {(job.status === "failed" || job.status === "stopped") && (
            <button className="btn btn-primary" onClick={() => act("retry")} disabled={busy}>
              {job.status === "stopped" ? "Continue" : "Retry"}
            </button>
          )}
        </div>
      </header>

      <ErrorNote>{actionError}</ErrorNote>
      {job.status === "failed" && <ErrorNote>Last error: {job.lastError}</ErrorNote>}

      <div className="detail-grid">
        <section className="panel panel-note" aria-labelledby="note-h">
          <h2 id="note-h">
            {draft
              ? "Edit before sending"
              : job.status === "synced"
                ? "Note in the CRM"
                : job.crm === "upload"
                  ? "AI note"
                  : "Note to be sent"}
          </h2>
          {draft && schema ? (
            <Editor draft={draft} setDraft={setDraft} schema={schema} />
          ) : job.note ? (
            job.note.format === "html" ? (
              <div className="note" dangerouslySetInnerHTML={{ __html: job.note.content }} />
            ) : (
              <pre className="note note-text">{job.note.content}</pre>
            )
          ) : (
            <p className="muted">The note appears once the call is analyzed.</p>
          )}
        </section>

        <section className="panel panel-transcript" aria-labelledby="tr-h">
          <h2 id="tr-h">Transcript</h2>
          {job.transcriptMeta && (
            <p className="sub">
              {job.transcriptMeta.words} words
              {typeof job.transcriptMeta.lowConfidenceShare === "number" &&
                `, ${Math.round(job.transcriptMeta.lowConfidenceShare * 100)}% unclear audio`}
              {analysis?.key_quotes?.length ? ". Highlighted lines are quoted in the note." : ""}
            </p>
          )}
          {job.transcript ? <Transcript
              text={job.transcript}
              quotes={analysis?.key_quotes}
              audioSrc={job.hasAudio ? `/api/calls/${encodeURIComponent(job.activityId)}/audio` : null}
            /> : <p className="muted">Not transcribed yet.</p>}

          {job.corrections?.length > 0 && (
            <div className="checks">
              <button className="btn-quiet" aria-expanded={showChecks} onClick={() => setShowChecks((v) => !v)}>
                {showChecks ? "Hide" : "Show"} {job.corrections.length} automatic correction{job.corrections.length > 1 ? "s" : ""}
              </button>
              {showChecks && (
                <ul>
                  {job.corrections.map((c, i) => (
                    <li key={i}>
                      <b>{label(c.field)}</b>: {c.reason}
                      {c.from != null && typeof c.from !== "object" && <span className="muted"> (AI said “{String(c.from)}”)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
