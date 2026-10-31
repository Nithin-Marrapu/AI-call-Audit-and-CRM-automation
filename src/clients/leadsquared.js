import { config } from "../config/index.js";

export function missingCredentials(creds) {
  return [
    ["host", creds?.host],
    ["accessKey", creds?.accessKey],
    ["secretKey", creds?.secretKey]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

// One request helper for every LeadSquared call:
// auth, timeout, JSON parsing and error handling live here only.
async function request(
  creds,
  pathname,
  { method = "POST", query = {}, body, label = pathname } = {}
) {
  const missing = missingCredentials(creds);
  if (missing.length) {
    throw new Error(
      `LeadSquared is not configured (missing ${missing.join(", ")}). ` +
        "Add it in Settings, or set LEADSQUARED_* in .env."
    );
  }
  const { host, accessKey, secretKey } = creds;
  const authMode = creds.authMode || "header";
  const timeoutMs = creds.timeoutMs || config.leadsquared.timeoutMs;

  const url = new URL(pathname, host.endsWith("/") ? host : `${host}/`);
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  if (authMode === "query") {
    url.searchParams.set("accessKey", accessKey);
    url.searchParams.set("secretKey", secretKey);
  } else {
    headers["x-LSQ-AccessKey"] = accessKey;
    headers["x-LSQ-SecretKey"] = secretKey;
  }

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    // Never include the URL here: in query mode it contains keys.
    throw new Error(`${label}: request failed (${error.cause?.code || error.message})`);
  }

  const rawText = await response.text();

  if (!rawText.trim()) {
    throw new Error(`${label}: empty response (HTTP ${response.status})`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      `${label}: non-JSON response (HTTP ${response.status}): ${rawText.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `${label}: HTTP ${response.status}: ${JSON.stringify(data)}`
    );
  }

  if (data?.Status && data.Status !== "Success") {
    throw new Error(`${label}: LeadSquared failure: ${JSON.stringify(data)}`);
  }

  return data;
}

// Builds a client bound to one set of credentials. The named exports
// below use the .env credentials (for the CLI helper scripts).
export function createClient(creds = config.leadsquared) {
  const r = (pathname, opts) => request(creds, pathname, opts);
  return {
    // Without Paging, LeadSquared returns only the latest 25 activities.
    getLeadActivities: (leadId, { activityEvent, page = 0, rowCount = 200 } = {}) =>
      r("ProspectActivity.svc/Retrieve", {
        query: { leadId },
        body: {
          ...(activityEvent != null && { Parameter: { ActivityEvent: Number(activityEvent) } }),
          Paging: { Offset: String(page), RowCount: String(rowCount) }
        },
        label: "Get lead activities"
      }),
    updateLeadFields: (leadId, fields) =>
      r("LeadManagement.svc/Lead.Update", { query: { leadId }, body: fields, label: "Update lead" }),
    getLeadsMetadata: () =>
      r("LeadManagement.svc/LeadsMetaData.Get", {
        method: "GET",
        query: { excludeOptionSets: 1 },
        label: "Get lead metadata"
      }),
    getActivityTypes: () =>
      r("ProspectActivity.svc/ActivityTypes.Get", { method: "GET", label: "Get activity types" }),
    // Returns [] when no lead has this ID.
    getLeadById: (id) =>
      r("LeadManagement.svc/Leads.GetById", { method: "GET", query: { id }, label: "Get lead" }),
    createLeadNote: ({ leadId, note }) =>
      r("LeadManagement.svc/CreateNote", {
        body: { RelatedProspectId: leadId, Note: note },
        label: "Create lead note"
      })
  };
}

const envClient = () => createClient(config.leadsquared);

export const getLeadActivities = (leadId, opts) => envClient().getLeadActivities(leadId, opts);

export const updateLeadFields = (leadId, fields) => envClient().updateLeadFields(leadId, fields);

export const getLeadsMetadata = () => envClient().getLeadsMetadata();

export const getActivityTypes = () => envClient().getActivityTypes();

export const createLeadNote = (args) => envClient().createLeadNote(args);
