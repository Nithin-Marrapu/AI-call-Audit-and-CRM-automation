// Checks that the watcher can see new calls: lists phone calls on any
// lead in the last N minutes (default 120). IDs are shortened.
// Usage: npm run lsq:recent -- 120
import { createClient } from "../src/clients/leadsquared.js";
import { config } from "../src/config/index.js";
import { lsqDate } from "../src/crm/leadsquared.js";

const minutes = Number(process.argv[2] || 120);
const to = new Date();
const from = new Date(to.getTime() - minutes * 60000);
const client = createClient();
const short = (v) => (v ? `${String(v).slice(0, 8)}…` : "-");

console.log(`Phone calls from ${lsqDate(from)} to ${lsqDate(to)} UTC (last ${minutes} min)\n`);
for (const code of config.callEventCodes) {
  try {
    const r = await client.getActivitiesByEvent({ activityEvent: code, from: lsqDate(from), to: lsqDate(to), pageSize: 50 });
    const rows = r?.List || [];
    console.log(`Event ${code}: ${r?.RecordCount ?? rows.length} call(s)`);
    const people = new Set(rows.map((a) => a.CreatedByName).filter(Boolean));
    if (rows.length) console.log(`  made by ${people.size} counsellor(s)`);
    console.table(rows.slice(0, 10).map((a) => ({ activity: short(a.ProspectActivityId), lead: short(a.RelatedProspectId), created: a.CreatedOn, by: String(a.CreatedByName || "-").split(" ")[0] })));
  } catch (error) {
    console.log(`Event ${code}: FAILED: ${error.message}`);
  }
}
