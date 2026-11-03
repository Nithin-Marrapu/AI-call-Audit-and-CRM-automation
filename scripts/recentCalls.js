// Shows what the watcher can see: activities on any lead in the last N
// minutes (default 120). IDs are shortened, phone numbers hidden.
// Usage: npm run lsq:recent -- 120              (phone calls)
//        npm run lsq:recent -- 4320 246 203     (other activity codes, with their form fields)
import { createClient } from "../src/clients/leadsquared.js";
import { config } from "../src/config/index.js";
import { lsqDate } from "../src/crm/leadsquared.js";

const [minArg, ...codeArgs] = process.argv.slice(2);
const minutes = Number(minArg || 120);
const codes = codeArgs.length ? codeArgs : config.callEventCodes;
const showFields = codeArgs.length > 0;
const to = new Date();
const from = new Date(to.getTime() - minutes * 60000);
const client = createClient();
const short = (v) => (v ? `${String(v).slice(0, 8)}…` : "-");
const hide = (v) =>
  String(v ?? "")
    .replace(/\+?\d[\d\s-]{8,}\d/g, "<phone>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>")
    .replace(/(token=)[^&\s]+/g, "$1…")
    .slice(0, 120);
const SKIP = /^(ProspectActivityId|RelatedProspectId|ActivityType|CreatedBy|CreatedByEmailAddress|ModifiedBy|ModifiedByEmailAddress|ModifiedOn|ModifiedByName|Extension_ModifiedBy|Owner)$/;

console.log(`From ${lsqDate(from)} to ${lsqDate(to)} UTC (last ${minutes} min)\n`);
for (const code of codes) {
  try {
    const r = await client.getActivitiesByEvent({ activityEvent: code, from: lsqDate(from), to: lsqDate(to), pageSize: 50 });
    const rows = r?.List || [];
    console.log(`Event ${code}: ${r?.RecordCount ?? rows.length} activit${rows.length === 1 ? "y" : "ies"}`);
    if (!rows.length) continue;
    const people = new Set(rows.map((a) => a.CreatedByName).filter(Boolean));
    console.log(`  made by ${people.size} person(s)`);
    console.table(rows.slice(0, 10).map((a) => ({ activity: short(a.ProspectActivityId), lead: short(a.RelatedProspectId), created: a.CreatedOn, by: String(a.CreatedByName || "-").split(" ")[0] })));
    if (showFields) {
      for (const a of rows.slice(0, 3)) {
        console.log(`  -- fields of ${short(a.ProspectActivityId)}`);
        for (const [k, v] of Object.entries(a)) if (!SKIP.test(k) && v !== null && v !== "") console.log(`     ${k} = ${hide(typeof v === "object" ? JSON.stringify(v) : v)}`);
      }
    }
    console.log();
  } catch (error) {
    console.log(`Event ${code}: FAILED: ${error.message}\n`);
  }
}
