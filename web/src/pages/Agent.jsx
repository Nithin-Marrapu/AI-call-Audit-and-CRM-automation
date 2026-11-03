import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useApi } from "../hooks.js";
import { when } from "../format.js";
import { ErrorNote } from "../components/bits.jsx";

const ago = (iso) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return when(iso);
};

const inMin = (iso) => {
  if (!iso) return null;
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  return s <= 30 ? "in a moment" : `in ${Math.ceil(s / 60)} min`;
};

// The watcher: finds new recorded calls in the CRM by itself and audits
// the long ones, so nobody pastes a lead ID.
export default function Agent() {
  const { data: w, error: loadError, reload, setData } = useApi("/watcher", { poll: 5000 });
  const { data: settings } = useApi("/settings");
  const { data: crms } = useApi("/crms");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const active = crms?.crms.find((c) => c.id === crms.active);

  async function change(update) {
    setBusy(true);
    setError(null);
    try {
      setData(await api.put("/watcher", update));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const [lookback, setLookback] = useState("");

  async function checkNow(lookbackHours) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/watcher/check", lookbackHours ? { lookbackHours } : {});
      setData(r.status);
    } catch (err) {
      setError(err.message);
      reload();
    } finally {
      setBusy(false);
    }
  }

  const t = w?.today || {};
  const min = settings?.minCallMinutes ?? 7;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Agent</h1>
          <p className="lede">
            Watches {active?.label ?? "your CRM"} for new recorded calls and audits every call of {min}+ minutes by
            itself. No lead IDs to paste.
          </p>
        </div>
      </header>

      <section className="panel agent-switch" aria-labelledby="agent-h">
        <div className="agent-state">
          <span className={`agent-dot ${w?.enabled ? "is-on" : ""}`} aria-hidden="true" />
          <div>
            <h2 id="agent-h">{w?.enabled ? "Watching for new calls" : "Agent is off"}</h2>
            <p className="sub">
              {w?.enabled
                ? `Last check ${ago(w.lastCheck)}${w.checking ? " (checking now)" : w.nextCheck ? `, next ${inMin(w.nextCheck)}` : ""}. ` +
                  (settings?.reviewMode ? "Notes wait in Review before reaching the CRM." : "Notes go straight to the CRM.")
                : "Turn it on to audit new calls automatically, starting from the last 30 minutes."}
            </p>
          </div>
        </div>
        <div className="agent-actions">
          {w?.enabled && (
            <button type="button" className="btn" onClick={() => checkNow()} disabled={busy || w.checking}>
              Check now
            </button>
          )}
          <button
            type="button"
            className={`btn ${w?.enabled ? "btn-danger" : "btn-primary"}`}
            onClick={() => change({ enabled: !w?.enabled })}
            disabled={busy || !w}
          >
            {w?.enabled ? "Turn off" : "Turn on"}
          </button>
        </div>
      </section>

      <ErrorNote>{error || loadError}</ErrorNote>
      {w?.lastError && !error && <ErrorNote>{`Last check failed: ${w.lastError}`}</ErrorNote>}

      <div className="field agent-interval">
        <label htmlFor="every">Check every</label>
        <select
          id="every"
          value={w?.intervalMinutes ?? 3}
          onChange={(e) => change({ intervalMinutes: Number(e.target.value) })}
          disabled={busy || !w}
        >
          {[1, 2, 3, 5, 10, 15].map((m) => (
            <option key={m} value={m}>
              {m} minute{m > 1 ? "s" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="agent-past">
        <div className="field">
          <label htmlFor="past">Test on past calls</label>
          <select id="past" value={lookback} onChange={(e) => setLookback(e.target.value)} disabled={busy}>
            <option value="">Choose a period</option>
            <option value="3">Last 3 hours</option>
            <option value="12">Last 12 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="72">Last 3 days</option>
          </select>
        </div>
        <button type="button" className="btn" onClick={() => checkNow(Number(lookback))} disabled={busy || !lookback || w?.checking}>
          {busy ? "Checking…" : "Check past calls"}
        </button>
        <p className="hint">Audits up to 10 calls of {min}+ minutes per check; run it again for more. Works even while the agent is off.</p>
      </div>

      <section className="overview agent-today" aria-label="Today">
        <div className="overview-counts">
          <p>
            <b className="big">{t.found ?? 0}</b> new calls found today
          </p>
          <p>
            <b className="big">{t.queued ?? 0}</b> audited
          </p>
          <p>
            <b className="big">{t.short ?? 0}</b> under {min} min, skipped
          </p>
          <p>
            <b className="big">{t.noRecording ?? 0}</b> no recording
          </p>
        </div>
      </section>

      <section aria-labelledby="ev-h">
        <h2 id="ev-h" className="section-title">
          What the agent did
        </h2>
        {!w?.events?.length ? (
          <p className="sub">Nothing yet. Audits it starts also show in Audit a lead, under Recent runs.</p>
        ) : (
          <ol className="agent-events">
            {w.events.map((e, i) => (
              <li key={i} className={`agent-event is-${e.type}`}>
                <span className="muted nowrap">{when(e.t)}</span>
                <span>{e.text}</span>
                {e.activityId && (
                  <Link to={`/calls/${encodeURIComponent(e.activityId)}`} className="btn-quiet">
                    Open call
                  </Link>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
