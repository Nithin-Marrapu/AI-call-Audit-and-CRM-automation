import { config } from "./config/index.js";
import { LEAD_FIELD_MAPPING } from "./config/crmFields.js";

// Settings edited in the UI are stored in SQLite. Anything not saved
// there falls back to .env, so the CLI keeps working without the UI.
export function defaultSettings() {
  const lsq = config.leadsquared;
  const hasEnvLsq = Boolean(lsq.host && lsq.accessKey && lsq.secretKey);

  return {
    crm: hasEnvLsq ? "leadsquared" : "demo",
    credentials: {
      leadsquared: {
        host: lsq.host || "",
        accessKey: lsq.accessKey || "",
        secretKey: lsq.secretKey || "",
        authMode: lsq.authMode || "header"
      }
    },
    minCallMinutes: config.minCallSeconds / 60,
    // false = write to the CRM as soon as the AI is done (CLI behavior)
    // true  = wait for someone to approve in the UI
    reviewMode: false,
    noteFormat: config.notes.format,
    fieldMapping: {
      leadsquared: LEAD_FIELD_MAPPING,
      demo: [
        { from: "customer.experience", to: "work_experience" },
        { from: "customer.designation", to: "job_role" },
        { from: "customer.company", to: "company" },
        { from: "customer.location", to: "city" }
      ]
    }
  };
}

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

export function loadSettings(store) {
  return merge(defaultSettings(), store.getSettings());
}

// Secret fields never leave the server in full.
const MASK = "••••";
export const maskSecret = (value) => (value ? `${MASK}${String(value).slice(-4)}` : "");

export function publicSettings(settings, connectors) {
  const credentials = {};
  for (const [crm, creds] of Object.entries(settings.credentials || {})) {
    const secretKeys = new Set(
      (connectors[crm]?.credentialFields || []).filter((f) => f.secret).map((f) => f.key)
    );
    credentials[crm] = Object.fromEntries(
      Object.entries(creds).map(([k, v]) => [k, secretKeys.has(k) ? maskSecret(v) : v])
    );
  }
  return { ...settings, credentials };
}

const ALLOWED = new Set(["crm", "credentials", "minCallMinutes", "reviewMode", "noteFormat", "fieldMapping"]);

// Validates a settings update from the UI. A masked or empty secret
// means "keep the saved value".
export function applySettingsUpdate(current, update, connectors) {
  const next = {};
  for (const [key, value] of Object.entries(update || {})) {
    if (!ALLOWED.has(key)) throw new Error(`Unknown setting "${key}"`);
    next[key] = value;
  }

  if (next.crm !== undefined && !connectors[next.crm]) {
    throw new Error(`Unknown CRM "${next.crm}"`);
  }
  if (next.minCallMinutes !== undefined) {
    const n = Number(next.minCallMinutes);
    if (!Number.isFinite(n) || n < 0 || n > 120) throw new Error("minCallMinutes must be 0-120");
    next.minCallMinutes = n;
  }
  if (next.reviewMode !== undefined) next.reviewMode = next.reviewMode === true;
  if (next.noteFormat !== undefined && !["html", "text"].includes(next.noteFormat)) {
    throw new Error('noteFormat must be "html" or "text"');
  }

  if (next.credentials !== undefined) {
    const merged = { ...current.credentials };
    for (const [crm, creds] of Object.entries(next.credentials)) {
      const fields = connectors[crm]?.credentialFields;
      if (!fields) throw new Error(`Unknown CRM "${crm}"`);
      const saved = current.credentials?.[crm] || {};
      const out = { ...saved };
      for (const f of fields) {
        if (!(f.key in creds)) continue;
        const v = String(creds[f.key] ?? "").trim();
        if (f.secret && (v === "" || v.startsWith(MASK))) continue;
        out[f.key] = v;
      }
      merged[crm] = out;
    }
    next.credentials = merged;
  }

  if (next.fieldMapping !== undefined) {
    const merged = { ...current.fieldMapping };
    for (const [crm, rows] of Object.entries(next.fieldMapping)) {
      if (!connectors[crm]) throw new Error(`Unknown CRM "${crm}"`);
      if (!Array.isArray(rows)) throw new Error("fieldMapping rows must be a list");
      merged[crm] = rows
        .map((r) => ({ from: String(r.from || "").trim(), to: String(r.to || "").trim() }))
        .filter((r) => r.from && r.to);
    }
    next.fieldMapping = merged;
  }

  return next;
}
