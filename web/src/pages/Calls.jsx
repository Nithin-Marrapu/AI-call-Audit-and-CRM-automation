import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "../hooks.js";
import { when, label } from "../format.js";
import { DurationBar, StatusChip, Interest, ErrorNote, Empty } from "../components/bits.jsx";

const FILTERS = [
  { id: "", text: "All" },
  { id: "review", text: "Needs review" },
  { id: "synced", text: "Sent to CRM" },
  { id: "failed", text: "Failed" },
  { id: "rejected", text: "Rejected" }
];

function InterestMix({ interest }) {
  const parts = ["hot", "warm", "cold"].map((k) => [k, interest?.[k] || 0]);
  const total = parts.reduce((n, [, v]) => n + v, 0);
  if (!total) return null;
  return (
    <div className="mix">
      <div className="mix-bar" role="img" aria-label={parts.map(([k, v]) => `${v} ${k}`).join(", ")}>
        {parts.map(([k, v]) => v > 0 && <span key={k} className={`mix-${k}`} style={{ flexGrow: v }} />)}
      </div>
      <div className="mix-legend">
        {parts.map(([k, v]) => (
          <span key={k}>
            <Interest level={k} /> <b>{v}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

// What leads pushed back on this week, grouped into themes. Clicking a
// theme searches the calls for it.
function TopObjections({ data, onPick }) {
  if (!data?.themes?.length) return null;
  const max = data.themes[0].count;
  return (
    <section className="objections" aria-labelledby="obj-h">
      <div className="objections-head">
        <h2 id="obj-h">Top objections this week</h2>
        <p className="sub">
          From {data.callsWithObjections} call{data.callsWithObjections === 1 ? "" : "s"} where the lead pushed back
        </p>
      </div>
      <ol className="objection-list">
        {data.themes.slice(0, 6).map((t, i) => (
          <li key={t.id}>
            <button
              type="button"
              className="objection"
              onClick={() => t.search && onPick(t.search)}
              disabled={!t.search}
              title={t.example ? `e.g. "${t.example}"` : undefined}
            >
              <span className="objection-label">{t.label}</span>
              <span className="objection-track" aria-hidden="true">
                <span className={`objection-fill ${i === 0 ? "is-top" : ""}`} style={{ width: `${(t.count / max) * 100}%` }} />
              </span>
              <span className="objection-count">
                {t.count} call{t.count === 1 ? "" : "s"}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

const PERIODS = [
  ["", "Any time"],
  ["1", "Last 24 hours"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"]
];

export default function Calls({ reviewOnly = false }) {
  // Filters live in the URL, so a filtered view can be bookmarked or shared.
  const [params, setParams] = useSearchParams();
  const filter = params.get("status") || "";
  const interest = params.get("interest") || "";
  const days = params.get("days") || "";
  const q = params.get("q") || "";
  const [typed, setTyped] = useState(q);

  const setParam = (key, value) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        value ? next.set(key, value) : next.delete(key);
        return next;
      },
      { replace: true }
    );
  const setFilter = (v) => setParam("status", v);

  // Search as you type, after a short pause.
  useEffect(() => {
    const t = setTimeout(() => typed !== q && setParam("q", typed.trim()), 300);
    return () => clearTimeout(t);
  }, [typed]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = reviewOnly ? "review" : filter;
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (interest) query.set("interest", interest);
  if (days) query.set("days", days);
  if (q) query.set("q", q);
  const filtered = Boolean(interest || days || q);

  const { data, error, loading } = useApi(`/calls?limit=100&${query}`, { poll: 4000 });
  const { data: stats } = useApi("/stats", { poll: 8000 });
  const { data: settings } = useApi("/settings");
  const navigate = useNavigate();
  const counts = data?.counts || {};
  const calls = data?.calls || [];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{reviewOnly ? "Review" : "Calls"}</h1>
          <p className="lede">
            {reviewOnly
              ? "Check each AI note against the call before it goes into the CRM."
              : `Calls of ${settings?.minCallMinutes ?? 7}+ minutes, audited and written to the lead's notes.`}
          </p>
        </div>
        <Link className="btn btn-primary" to="/process">
          Audit a lead
        </Link>
      </header>

      {!reviewOnly && (
        <section className="overview" aria-label="Overview">
          <div className="overview-counts">
            <p>
              <b className="big">{stats?.total ?? "–"}</b> calls audited
            </p>
            <p>
              <b className="big">{counts.review || 0}</b> waiting for review
            </p>
            <p>
              <b className="big">{counts.synced || 0}</b> sent to CRM
            </p>
          </div>
          <InterestMix interest={stats?.interest} />
        </section>
      )}

      {!reviewOnly && (
        <TopObjections
          data={stats?.objections}
          onPick={(word) => {
            setTyped(word);
            setParam("q", word);
          }}
        />
      )}

      {!reviewOnly && (
        <div className="tabs" role="tablist" aria-label="Filter calls">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? "is-active" : ""}
              onClick={() => setFilter(f.id)}
            >
              {f.text}
              {f.id && counts[f.id] ? <span className="tab-count">{counts[f.id]}</span> : null}
            </button>
          ))}
        </div>
      )}

      <div className="filters" role="search">
        <div className="field search-field">
          <label htmlFor="q" className="sr-only">Search calls</label>
          <input
            id="q"
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Search transcripts and notes, e.g. EMI, placement, a name"
          />
        </div>
        <div className="field">
          <label htmlFor="f-int" className="sr-only">Interest</label>
          <select id="f-int" value={interest} onChange={(e) => setParam("interest", e.target.value)}>
            <option value="">Any interest</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-days" className="sr-only">Period</label>
          <select id="f-days" value={days} onChange={(e) => setParam("days", e.target.value)}>
            {PERIODS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <a className="btn" href={`/api/calls.csv?${query}`} download>
          Export CSV
        </a>
      </div>

      {filtered && data && (
        <p className="filter-result">
          {data.total} call{data.total === 1 ? "" : "s"} match
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setTyped("");
              setParams(status && !reviewOnly ? { status } : {}, { replace: true });
            }}
          >
            Clear filters
          </button>
        </p>
      )}

      <ErrorNote>{error}</ErrorNote>

      {!loading && !error && calls.length === 0 && filtered && (
        <Empty title="No calls match">
          <p>Try other words, or widen the period.</p>
        </Empty>
      )}

      {!loading && !error && calls.length === 0 && !filtered && (
        <Empty title={reviewOnly ? "Nothing to review" : "No calls yet"}>
          {reviewOnly ? (
            <p>
              Calls appear here when review mode is on. Turn it on in <Link to="/settings">Settings</Link> to approve
              notes before they reach the CRM.
            </p>
          ) : (
            <p>
              <Link to="/process">Audit a lead</Link> to process its latest long call.
            </p>
          )}
        </Empty>
      )}

      {calls.length > 0 && (
        <table className="calls">
          <thead>
            <tr>
              <th scope="col">Lead</th>
              <th scope="col">Call</th>
              <th scope="col">Length</th>
              <th scope="col">Interest</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.activityId} onClick={() => navigate(`/calls/${encodeURIComponent(c.activityId)}`)}>
                <td className="lead-cell">
                  <Link to={`/calls/${encodeURIComponent(c.activityId)}`} onClick={(e) => e.stopPropagation()}>
                    {c.leadName || <span className="mono-id">{c.leadId.slice(0, 8)}</span>}
                  </Link>
                  <span className="summary">{c.lastError && c.status === "failed" ? c.lastError : c.summary}</span>
                </td>
                <td className="nowrap">
                  {when(c.createdOn)}
                  <span className="sub">{c.callType ? label(c.callType) : ""}</span>
                </td>
                <td>
                  <DurationBar seconds={c.duration} minMinutes={settings?.minCallMinutes ?? 7} />
                </td>
                <td>
                  <Interest level={c.interest} />
                </td>
                <td>
                  <StatusChip status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
