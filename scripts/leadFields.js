// Lists LeadSquared lead fields so you can fill src/config/crmFields.js.
// Usage: npm run lsq:fields -- [search text]
import { getLeadsMetadata } from "../src/clients/leadsquared.js";

const search = (process.argv[2] || "").toLowerCase();
const fields = await getLeadsMetadata();

const rows = fields
  .map((f) => ({ display: f.DisplayName, schema: f.SchemaName, type: f.DataType }))
  .filter((f) => !search || `${f.display} ${f.schema}`.toLowerCase().includes(search));

console.table(rows);
