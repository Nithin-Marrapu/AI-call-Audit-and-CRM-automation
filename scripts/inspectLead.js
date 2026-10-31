// Shows every activity on a lead with its field names and values, so we
// can see exactly what a process form (e.g. "Phone call (pre Demo)")
// stores and copy those field names into the config.
// Usage: npm run lsq:inspect -- <leadId> [filter text]
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config/index.js";
import { getLeadActivities } from "../src/clients/leadsquared.js";

const [leadId, filter = ""] = process.argv.slice(2);
if (!leadId) {
  console.log("Usage: npm run lsq:inspect -- <leadId> [filter text]");
  process.exit(1);
}

const SKIP = new Set([
  "RelatedProspectId", "Id", "SessionId", "Latitude", "Longitude",
  "TrackLocation", "IsEmailType", "ActivityScore", "Address", "City",
  "State", "Country", "ModifiedOn", "HasAttachments"
]);

// Mask phone numbers and emails so the output is safe to paste.
const mask = (v) =>
  String(v)
    .replace(/(?<![\d:-])\+?(?:91[\s-]?)?[6-9]\d{9}(?![\d:])/g, "<phone>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>")
    .slice(0, 120);

// Up to 200 activities (without paging LeadSquared returns only 25).
const { ProspectActivities = [] } = await getLeadActivities(leadId, { rowCount: 200 });

// "pre demo" matches "Pre-Demo", "PreDemo", "pre_demo"...
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const matches = ProspectActivities.filter((a) => norm(a.EventName).includes(norm(filter)));

const lines = [];
const out = (line) => {
  console.log(line);
  lines.push(line);
};

const counts = {};
for (const a of ProspectActivities) {
  const key = `[${a.EventCode}] ${a.EventName}`;
  counts[key] = (counts[key] || 0) + 1;
}
out("Activity types on this lead:");
for (const [key, n] of Object.entries(counts)) out(`   ${n} x ${key}`);

for (const a of matches) {
  out(`\n== [${a.EventCode}] ${a.EventName}  (${a.CreatedOn})`);
  for (const [key, value] of Object.entries(a)) {
    if (SKIP.has(key) || key === "Data" || value === "" || value == null) continue;
    if (key === "ActivityFields" && typeof value === "object") {
      // Process-form answers live here, e.g. mx_Custom_1 = "Yes".
      for (const [field, v] of Object.entries(value)) {
        if (v === "" || v == null) continue;
        out(`   ActivityFields.${field} = ${mask(typeof v === "object" ? JSON.stringify(v) : v)}`);
      }
      continue;
    }
    out(`   ${key} = ${mask(typeof value === "object" ? JSON.stringify(value) : value)}`);
  }
  for (const item of a.Data ?? []) {
    if (item?.Value === "" || item?.Value == null) continue;
    out(`   Data.${item.Key} = ${mask(item.Value)}`);
  }
}

out(`\n${matches.length} of ${ProspectActivities.length} activities shown.`);

const file = path.join(config.paths.dataDir, "inspect", `${leadId.replace(/[^\w-]/g, "_")}.txt`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, lines.join("\n"));
console.log(`Saved to ${file}`);
