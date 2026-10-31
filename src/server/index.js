import { config } from "../config/index.js";
import { JobStore } from "../db/jobStore.js";
import { backfillLeadNames, createApp } from "./app.js";
import { log } from "../lib/log.js";

const store = new JobStore(config.paths.db);
store.importLegacy(config.paths.legacyProcessedFile);

// No login yet, and Settings holds CRM keys: listen on this machine only.
// Set HOST=0.0.0.0 only behind a proxy that adds authentication.
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5050);

createApp(store).listen(port, host, () => {
  log.ok(`AI Call Audit running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}`);
  backfillLeadNames(store, { log: log.info }).then((n) => n && log.ok(`Added names for ${n} lead(s)`));
});
