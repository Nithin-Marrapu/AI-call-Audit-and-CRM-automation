// Lists LeadSquared activity types (event codes) in your account.
// Usage: npm run lsq:activities
import { getActivityTypes } from "../src/clients/leadsquared.js";

const types = await getActivityTypes();
console.table(
  (Array.isArray(types) ? types : []).map((t) => ({
    event: t.ActivityEvent,
    name: t.ActivityEventName ?? t.DisplayName
  }))
);
