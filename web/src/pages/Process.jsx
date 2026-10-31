import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../hooks.js";
import { DurationBar, ErrorNote } from "../components/bits.jsx";

// Looks up the lead's name in the CRM as an ID is pasted or typed.
function useLeadName(leadId) {
  const [state, setState] = useState({ status: "idle", name: null });
  useEffect(() => {
    const id = leadId.trim();
    if (id.length < 6) return setState({ status: "idle", name: null });
    setState((s) => ({ ...s, status: "loading" }));
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.get(`/crm/leads/${encodeURIComponent(id)}/name`);
        if (live) setState(r.found === null ? { status: "idle", name: null } : { status: r.found ? "found" : "missing", name: r.name });
      } catch {
        if (live) setState({ status: "idle", name: null });
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [leadId]);
  return state;
}

function LeadName({ state, crmLabel, fallback }) {
  if (state.status === "found") return <p className="lead-found">{state.name}</p>;
  if (state.status === "missing") return <p className="error-text">No lead with this ID in {crmLabel}.</p>;
  if (state.status === "loading") return <p className="hint">Looking up the lead…</p>;
  return fallback ? <p className="hint">{fallback}</p> : null;
}

const STATE_TEXT = { queued: "Waiting", running: "Running", done: "Finished", failed: "Failed", stopped: "Stopped" };

const STEP_TEXT = {
  download: "Downloading the recording",
  clean: "Cleaning the audio",
  transcribe: "Transcribing",
  analyze: "Analyzing the call",
  save: "Saving the note"
};

// 0-100% across all steps. Transcription progress comes from Whisper;
// analysis is estimated from how much of the answer the model has written.
function ProgressMeter({ job }) {
  const pct = Math.max(0, Math.min(100, job.progress ?? 0));
  const stopped = job.state === "stopped" || job.state === "failed";
  const text = job.state === "queued" ? "Waiting for the current call to finish" : STEP_TEXT[job.step] || "Starting";
  return (
    <div className={`meter ${stopped ? "is-halted" : ""}`}>
      <div
        className="meter-track"
        role="progressbar"
        aria-label="Audit progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%, ${text}`}
      >
        <span className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="meter-text">
        <b>{pct}%</b>
        <span>{stopped ? `${job.state === "failed" ? "Failed" : "Stopped"} while ${(STEP_TEXT[job.step] || "starting").toLowerCase()}` : text}</span>
      </div>
    </div>
  );
}

function JobLog({ job, onChange }) {
  const [busy, setBusy] = useState(false);
  const active = job.state === "queued" || job.state === "running";

  async function stop() {
    setBusy(true);
    try {
      await api.post(`/jobs/${job.id}/stop`);
    } catch {
      // already finished; the next refresh shows it
    } finally {
      setBusy(false);
      onChange();
    }
  }

  return (
    <li className={`job job-${job.state}`}>
      <div className="job-head">
        <b>{job.label}</b>
        <span className="job-head-right">
          <span className="job-state">{job.stopping && active ? "Stopping…" : STATE_TEXT[job.state]}</span>
          {active && (
            <button type="button" className="btn btn-small btn-danger" onClick={stop} disabled={busy || job.stopping}>
              {job.state === "queued" ? "Cancel" : "Stop"}
            </button>
          )}
        </span>
      </div>
      {(active || ((job.state === "stopped" || job.state === "failed") && job.progress > 0)) && <ProgressMeter job={job} />}
      <ol className="job-lines">
        {job.logs.map((l, i) => (
          <li key={i} className={`line-${l.level}`}>
            {l.msg}
          </li>
        ))}
      </ol>
      {(job.result?.activityId || (job.state === "stopped" && job.activityId)) && (
        <Link className="btn btn-small" to={`/calls/${encodeURIComponent(job.result?.activityId || job.activityId)}`}>
          Open call
        </Link>
      )}
    </li>
  );
}

// Audits a recording from the user's computer. Linking a CRM lead is
// optional; without it the analysis stays in this app.
function UploadForm({ crmLabel, reviewMode, onQueued }) {
  const [file, setFile] = useState(null);
  const [name, setName] = useState("");
  const [leadId, setLeadId] = useState("");
  const uploadLead = useLeadName(leadId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [inputKey, setInputKey] = useState(0);

  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ filename: file.name });
      if (name.trim()) q.set("name", name.trim());
      if (leadId.trim()) q.set("leadId", leadId.trim());
      const res = await fetch(`/api/upload?${q}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      setFile(null);
      setName("");
      setLeadId("");
      setInputKey((k) => k + 1);
      onQueued();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const mb = file ? (file.size / 1024 / 1024).toFixed(1) : null;

  return (
    <form className="process-form upload-form" onSubmit={submit} aria-labelledby="up-h">
      <div>
        <h2 id="up-h" className="section-title">Upload a recording</h2>
        <p className="sub">For calls that aren't in a CRM. Any length is audited.</p>
      </div>

      <label className={`drop ${file ? "has-file" : ""}`}>
        <input
          key={inputKey}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.webm"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        {file ? (
          <span>
            <b>{file.name}</b> <span className="muted">{mb} MB</span>
          </span>
        ) : (
          <span>
            <b>Choose an audio file</b> <span className="muted">mp3, wav, m4a or ogg, up to 200 MB</span>
          </span>
        )}
      </label>

      <div className="upload-fields">
        <div className="field">
          <label htmlFor="up-name">Name (optional)</label>
          <input id="up-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ravi, demo follow-up" />
        </div>
        <div className="field">
          <label htmlFor="up-lead">{crmLabel} lead ID (optional)</label>
          <input
            id="up-lead"
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            placeholder="Leave empty to keep it in this app"
            autoComplete="off"
            spellCheck="false"
          />
          {leadId.trim() ? (
            <>
              <LeadName state={uploadLead} crmLabel={crmLabel} />
              {uploadLead.status === "found" && (
                <p className="hint">The note goes to this lead{reviewMode ? " after you approve it" : ""}.</p>
              )}
            </>
          ) : (
            <p className="hint">Nothing is sent to a CRM.</p>
          )}
        </div>
      </div>

      <ErrorNote>{error}</ErrorNote>
      <button className="btn btn-primary" disabled={!file || busy || uploadLead.status === "missing"}>
        {busy ? "Uploading…" : "Upload and audit"}
      </button>
    </form>
  );
}

export default function Process() {
  const { data: settings } = useApi("/settings");
  const { data: crms } = useApi("/crms");
  const { data: leads } = useApi("/crm/leads");
  const [poll, setPoll] = useState(3000);
  const { data: jobsData, reload: reloadJobs } = useApi("/jobs", { poll });
  const [leadId, setLeadId] = useState("");
  const leadName = useLeadName(leads?.supported ? "" : leadId);
  const [minMinutes, setMinMinutes] = useState("");
  const [force, setForce] = useState(false);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  const jobs = jobsData?.jobs || [];
  const activeCount = jobs.filter((j) => j.state === "queued" || j.state === "running").length;
  const running = activeCount > 0;

  async function stopAll() {
    try {
      await api.post("/jobs/stop-all");
    } finally {
      reloadJobs();
    }
  }
  useEffect(() => setPoll(running ? 1000 : 4000), [running]);

  const active = crms?.crms.find((c) => c.id === crms.active);
  const min = minMinutes === "" ? settings?.minCallMinutes ?? 7 : Number(minMinutes);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setSending(true);
    try {
      await api.post("/process", { leadId: leadId.trim(), force, minMinutes: min });
      await reloadJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Audit a lead</h1>
          <p className="lede">
            Finds the lead's newest call of {min}+ minutes in {active?.label ?? "your CRM"}, transcribes it, and writes
            the note{settings?.reviewMode ? " for review" : " to the CRM"}.
          </p>
        </div>
      </header>

      <form className="process-form" onSubmit={submit}>
        {leads?.supported ? (
          <fieldset className="lead-pick">
            <legend>Lead</legend>
            {leads.leads.map((l) => (
              <label key={l.id} className={`lead-option ${leadId === l.id ? "is-picked" : ""}`}>
                <input type="radio" name="lead" value={l.id} checked={leadId === l.id} onChange={() => setLeadId(l.id)} />
                <span className="lead-name">{l.name}</span>
                <span className="muted">
                  {l.calls} call{l.calls > 1 ? "s" : ""}, longest
                </span>
                <DurationBar seconds={l.longestCallSeconds} minMinutes={min} />
              </label>
            ))}
          </fieldset>
        ) : (
          <div className="field field-wide">
            <label htmlFor="lead">Lead ID</label>
            <input
              id="lead"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              placeholder="e.g. 3f2a9c1e-7b4d-4e21-…"
              autoComplete="off"
              spellCheck="false"
            />
            <LeadName state={leadName} crmLabel={active?.label ?? "the CRM"} fallback={active?.leadIdHint} />
          </div>
        )}

        <div className="process-options">
          <div className="field">
            <label htmlFor="min">Minimum call length (minutes)</label>
            <input
              id="min"
              type="number"
              min="0"
              max="120"
              value={minMinutes}
              placeholder={String(settings?.minCallMinutes ?? 7)}
              onChange={(e) => setMinMinutes(e.target.value)}
            />
          </div>
          <label className="inline-check">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            Redo even if this call was already sent
          </label>
        </div>

        <ErrorNote>{error}</ErrorNote>

        <button className="btn btn-primary" disabled={!leadId.trim() || sending || leadName.status === "missing"}>
          {sending ? "Adding…" : leadName.status === "found" ? `Audit ${leadName.name.split(" ")[0]}'s latest long call` : "Audit latest long call"}
        </button>
      </form>

      <UploadForm crmLabel={active?.label ?? "CRM"} reviewMode={settings?.reviewMode} onQueued={reloadJobs} />

      {jobs.length > 0 && (
        <section aria-labelledby="jobs-h">
          <div className="jobs-head">
            <div>
              <h2 id="jobs-h" className="section-title">
                Recent runs
              </h2>
              <p className="sub">
                Calls run one at a time; a long call can take a minute or more. Stopping keeps the progress, so you
                can retry the call later.
              </p>
            </div>
            {activeCount > 1 && (
              <button type="button" className="btn btn-danger" onClick={stopAll}>
                Stop all ({activeCount})
              </button>
            )}
          </div>
          <ul className="jobs">
            {jobs.slice(0, 8).map((j) => (
              <JobLog key={j.id} job={j} onChange={reloadJobs} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
