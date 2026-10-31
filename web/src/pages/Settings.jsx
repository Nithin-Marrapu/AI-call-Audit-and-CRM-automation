import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApi } from "../hooks.js";
import { ErrorNote } from "../components/bits.jsx";

export default function Settings() {
  const { data: saved, setData: setSaved } = useApi("/settings");
  const { data: crms } = useApi("/crms");
  const { data: schema } = useApi("/schema");
  const [form, setForm] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const { data: fieldsData, error: fieldsError, reload: reloadFields } = useApi(saved ? "/crm/fields" : null);

  useEffect(() => {
    if (saved && !form) setForm(structuredClone(saved));
  }, [saved, form]);

  if (!form || !crms || !schema) return <div className="page"><p className="muted">Loading…</p></div>;

  const connector = crms.crms.find((c) => c.id === form.crm);
  const creds = form.credentials[form.crm] || {};
  const mapping = form.fieldMapping[form.crm] || [];
  const crmChanged = form.crm !== saved.crm;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const update = (fn) => {
    setStatus(null);
    setForm((f) => {
      const next = structuredClone(f);
      fn(next);
      return next;
    });
  };
  const setCred = (key, value) => update((f) => ((f.credentials[f.crm] ??= {})[key] = value));
  const setRow = (i, prop, value) => update((f) => (f.fieldMapping[f.crm][i][prop] = value));

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.post("/crm/test", { crm: form.crm, credentials: { [form.crm]: creds } }));
    } catch (e) {
      setTest({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    try {
      const next = await api.put("/settings", {
        crm: form.crm,
        credentials: form.credentials,
        minCallMinutes: Number(form.minCallMinutes),
        reviewMode: form.reviewMode,
        noteFormat: form.noteFormat,
        fieldMapping: form.fieldMapping
      });
      setSaved(next);
      setForm(structuredClone(next));
      setStatus("Settings saved.");
      reloadFields();
    } catch (err) {
      setError(err.message);
    }
  }

  const crmFields = fieldsData?.crm === form.crm ? fieldsData.fields : [];

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">Choose where calls come from and where the notes go.</p>
        </div>
      </header>

      <form className="settings" onSubmit={save}>
        <section aria-labelledby="crm-h">
          <h2 id="crm-h" className="section-title">CRM</h2>
          <div className="crm-options" role="radiogroup" aria-labelledby="crm-h">
            {crms.crms.map((c) => (
              <label key={c.id} className={`crm-option ${form.crm === c.id ? "is-picked" : ""}`}>
                <input
                  type="radio"
                  name="crm"
                  value={c.id}
                  checked={form.crm === c.id}
                  onChange={() => {
                    setTest(null);
                    update((f) => (f.crm = c.id));
                  }}
                />
                <span className="crm-name">{c.label}</span>
                <span className="crm-desc">{c.description}</span>
              </label>
            ))}
          </div>

          {connector.credentialFields.length > 0 && (
            <div className="creds">
              {connector.credentialFields.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`c-${f.key}`}>{f.label}</label>
                  {f.options ? (
                    <select id={`c-${f.key}`} value={creds[f.key] || f.options[0]} onChange={(e) => setCred(f.key, e.target.value)}>
                      {f.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={`c-${f.key}`}
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      spellCheck="false"
                      placeholder={f.secret && creds[f.key] ? "Saved. Type to replace." : f.placeholder}
                      value={f.secret && String(creds[f.key] || "").startsWith("••••") ? "" : creds[f.key] || ""}
                      onChange={(e) => setCred(f.key, e.target.value)}
                    />
                  )}
                  {f.secret && String(creds[f.key] || "").startsWith("••••") && (
                    <p className="hint">Saved key ending {String(creds[f.key]).slice(-4)}</p>
                  )}
                </div>
              ))}
              <p className="hint field-wide">Keys are stored only in this machine's local database.</p>
            </div>
          )}

          <div className="test-row">
            <button type="button" className="btn" onClick={runTest} disabled={testing}>
              {testing ? "Testing…" : "Test connection"}
            </button>
            {test && <span className={test.ok ? "ok-text" : "error-text"}>{test.message}</span>}
          </div>
        </section>

        <section aria-labelledby="flow-h">
          <h2 id="flow-h" className="section-title">Workflow</h2>
          <label className="toggle">
            <input type="checkbox" checked={form.reviewMode} onChange={(e) => update((f) => (f.reviewMode = e.target.checked))} />
            <span>
              <b>Review notes before they reach the CRM</b>
              <span className="hint">
                Off: the note is written as soon as the AI finishes. On: it waits in Review until someone approves it.
                Reviews also feed the Accuracy page.
              </span>
            </span>
          </label>
          <div className="flow-fields">
            <div className="field">
              <label htmlFor="min">Minimum call length (minutes)</label>
              <input
                id="min"
                type="number"
                min="0"
                max="120"
                value={form.minCallMinutes}
                onChange={(e) => update((f) => (f.minCallMinutes = e.target.value))}
              />
              <p className="hint">Shorter calls rarely show the lead's intent and are skipped.</p>
            </div>
            <div className="field">
              <label htmlFor="fmt">Note format</label>
              <select id="fmt" value={form.noteFormat} onChange={(e) => update((f) => (f.noteFormat = e.target.value))}>
                <option value="html">Formatted (bold, lists)</option>
                <option value="text">Plain text</option>
              </select>
              <p className="hint">Use plain text if your CRM shows raw tags like &lt;b&gt;.</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="map-h">
          <h2 id="map-h" className="section-title">Lead fields to update</h2>
          <p className="sub">
            Besides the note, these AI findings are copied into {connector.label} lead fields. Leave a finding out to
            never overwrite that field.
          </p>
          {crmChanged ? (
            <p className="hint">Save to load {connector.label}'s fields.</p>
          ) : (
            <>
              {fieldsError && <ErrorNote>Couldn't load CRM fields: {fieldsError}</ErrorNote>}
              <table className="mapping">
                <thead>
                  <tr>
                    <th scope="col">AI finding</th>
                    <th scope="col">{connector.label} field</th>
                    <th scope="col"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.map((row, i) => (
                    <tr key={i}>
                      <td>
                        <select aria-label="AI finding" value={row.from} onChange={(e) => setRow(i, "from", e.target.value)}>
                          {schema.mappableFields.map((m) => (
                            <option key={m.path} value={m.path}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {crmFields.length ? (
                          <select aria-label="CRM field" value={row.to} onChange={(e) => setRow(i, "to", e.target.value)}>
                            {!crmFields.some((f) => f.name === row.to) && <option value={row.to}>{row.to}</option>}
                            {crmFields.map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.label} ({f.name})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input aria-label="CRM field" value={row.to} onChange={(e) => setRow(i, "to", e.target.value)} />
                        )}
                      </td>
                      <td>
                        <button type="button" className="btn-quiet" onClick={() => update((f) => f.fieldMapping[f.crm].splice(i, 1))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="btn-quiet"
                onClick={() =>
                  update((f) => (f.fieldMapping[f.crm] ??= []).push({ from: schema.mappableFields[0].path, to: crmFields[0]?.name || "" }))
                }
              >
                Add field
              </button>
            </>
          )}
        </section>

        <div className="save-bar">
          <ErrorNote>{error}</ErrorNote>
          {status && <span className="ok-text" role="status">{status}</span>}
          <button className="btn btn-primary" disabled={!dirty}>
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}
