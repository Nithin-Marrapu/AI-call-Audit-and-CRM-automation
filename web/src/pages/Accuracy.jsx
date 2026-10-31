import { Link } from "react-router-dom";
import { useApi } from "../hooks.js";
import { label, when } from "../format.js";
import { Empty, ErrorNote } from "../components/bits.jsx";

function Bar({ value }) {
  if (value == null) return <span className="muted">–</span>;
  const tone = value >= 90 ? "good" : value >= 70 ? "fair" : "poor";
  return (
    <span className="acc">
      <span className="acc-track" aria-hidden="true">
        <span className={`acc-fill acc-${tone}`} style={{ width: `${value}%` }} />
      </span>
      <b>{value}%</b>
    </span>
  );
}

export default function Accuracy() {
  const { data, error } = useApi("/accuracy", { poll: 10000 });
  const { data: settings } = useApi("/settings");
  const { data: schema } = useApi("/schema");
  const fieldLabel = (p) => schema?.trackedFields.find((f) => f.path === p)?.label ?? label(p);

  if (error) return <div className="page"><ErrorNote>{error}</ErrorNote></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;

  const h = data.health;
  const fields = [...data.fields].sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Accuracy</h1>
          <p className="lede">
            How often the AI's findings survive human review. Each approved call is a check; each edit marks the fields
            the AI got wrong.
          </p>
        </div>
      </header>

      {data.reviewedCalls === 0 ? (
        <Empty title="No reviewed calls yet">
          <p>
            {settings?.reviewMode ? (
              <>
                Approve or edit calls in <Link to="/review">Review</Link> and accuracy appears here.
              </>
            ) : (
              <>
                Turn on review in <Link to="/settings">Settings</Link>, then approve or fix a few calls. Twenty reviewed
                calls give a useful first picture.
              </>
            )}
          </p>
        </Empty>
      ) : (
        <>
          <section className="overview" aria-label="Review results">
            <div className="overview-counts">
              <p>
                <b className="big">{data.approvedWithoutEdits ?? "–"}%</b> approved without changes
              </p>
              <p>
                <b className="big">{data.actions.edited}</b> approved with edits
              </p>
              <p>
                <b className="big">{data.actions.rejected}</b> rejected
              </p>
            </div>
            <p className="hint">
              Based on {data.reviewedCalls} reviewed call{data.reviewedCalls > 1 ? "s" : ""}.
              {data.reviewedCalls < 20 && " Numbers settle after about 20."}
            </p>
          </section>

          <section aria-labelledby="fields-h">
            <h2 id="fields-h" className="section-title">By field, weakest first</h2>
            <table className="acc-table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Kept as is</th>
                  <th scope="col">Changed</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.path}>
                    <td>
                      {f.label}
                      {f.text && <span className="sub">Any wording change counts</span>}
                    </td>
                    <td>
                      <Bar value={f.accuracy} />
                    </td>
                    <td className="num">
                      {f.changed} of {f.reviewed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {data.recentEdits.length > 0 && (
            <section aria-labelledby="edits-h">
              <h2 id="edits-h" className="section-title">Recent edits</h2>
              <ul className="edits">
                {data.recentEdits.map((e) => (
                  <li key={e.activityId}>
                    <Link to={`/calls/${encodeURIComponent(e.activityId)}`}>{when(e.reviewedAt)}</Link>
                    <span>{e.fields.map(fieldLabel).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section aria-labelledby="health-h">
        <h2 id="health-h" className="section-title">Pipeline checks</h2>
        <p className="sub">Measured on all {h.analyzedCalls} analyzed calls, reviewed or not.</p>
        <dl className="health">
          <div>
            <dt>Automatic corrections per call</dt>
            <dd>{h.ruleCorrectionsPerCall ?? "–"}</dd>
          </div>
          <div>
            <dt>Invented quotes caught</dt>
            <dd>{h.inventedQuotesDropped}</dd>
          </div>
          <div>
            <dt>Unclear audio, average</dt>
            <dd>{h.avgLowConfidencePct == null ? "–" : `${h.avgLowConfidencePct}%`}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
