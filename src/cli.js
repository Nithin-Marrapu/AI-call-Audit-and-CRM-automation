#!/usr/bin/env node
import { config } from "./config/index.js";
import { JobStore } from "./db/jobStore.js";
import { processCall, processLead } from "./pipeline.js";
import { createCrm, createCrmForJob } from "./crm/index.js";
import { loadSettings } from "./settings.js";
import { log } from "./lib/log.js";

const USAGE = `
Usage:
  npm run process -- <leadId> [--force] [--min-minutes N]
                                          Audit the newest call of at least N minutes (default 7)
  npm run status  -- [--failed] [--limit N]  Show recent calls and their state
  npm run show    -- <activityId>         Print transcript + analysis for a call
  npm run retry   -- <activityId>         Resume a failed call from its last stage

Uses the CRM and settings chosen in the web app (npm run app), with .env as fallback.
`;

function openStore() {
  const store = new JobStore(config.paths.db);
  const imported = store.importLegacy(config.paths.legacyProcessedFile);
  if (imported) {
    log.info(`Imported ${imported} call(s) from processed-calls.json (marked as synced).`);
  }
  return store;
}

function flag(args, name) {
  return args.includes(name);
}

function option(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  // Values that follow an option (e.g. --min-minutes 5) are not positional.
  const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--min-minutes" && args[i - 1] !== "--limit");

  if (!command || command === "help") {
    console.log(USAGE);
    return;
  }

  const store = openStore();
  const settings = loadSettings(store);
  const crm = () => createCrm(settings, store);

  try {
    switch (command) {
      case "process": {
        const leadId = positional[0];
        if (!leadId) throw new Error(`Missing <leadId>.\n${USAGE}`);
        const minutes = option(args, "--min-minutes", null);
        const job = await processLead(store, leadId, {
          crm: crm(),
          force: flag(args, "--force"),
          reviewMode: settings.reviewMode,
          minSeconds: (minutes !== null ? Number(minutes) : settings.minCallMinutes) * 60
        });
        if (job) log.ok(`Done: ${job.activityId} is ${job.status}`);
        break;
      }

      case "retry": {
        const id = positional[0];
        if (!id) throw new Error(`Missing <activityId>.\n${USAGE}`);
        const job = await processCall(store, id, {
          crm: createCrmForJob(settings, store, store.get(id)),
          reviewMode: settings.reviewMode
        });
        log.ok(`Done: ${job.activityId} is ${job.status}`);
        break;
      }

      case "status": {
        const jobs = store.list({
          status: flag(args, "--failed") ? "failed" : undefined,
          limit: Number(option(args, "--limit", 20))
        });
        console.log("Totals:", store.counts());
        console.table(
          jobs.map((j) => ({
            activity: j.activityId.slice(0, 8),
            lead: j.leadId.slice(0, 8),
            status: j.status,
            stage: j.stage,
            outcome: j.analysis?.outcome ?? "",
            attempts: j.attempts,
            error: (j.lastError ?? "").slice(0, 60)
          }))
        );
        break;
      }

      case "show": {
        const job = store.get(positional[0]);
        if (!job) throw new Error("No such call.");
        if (job.transcriptMeta) {
          const m = job.transcriptMeta;
          console.log(
            `\nTRANSCRIPT (${m.backend}: ${m.model}, ${m.words} words, ` +
              `${Math.round((m.lowConfidenceShare ?? 0) * 100)}% low-confidence)`
          );
        } else {
          console.log("\nTRANSCRIPT");
        }
        console.log(job.transcript ?? "(none)");
        console.log("\nANALYSIS\n" + JSON.stringify(job.analysis, null, 2));
        if (job.corrections?.length) {
          console.log("\nRULE CORRECTIONS\n" + JSON.stringify(job.corrections, null, 2));
        }
        break;
      }

      default:
        throw new Error(`Unknown command "${command}".\n${USAGE}`);
    }
  } finally {
    store.close();
  }
}

main().catch((error) => {
  log.error(error.message);
  log.info("Progress is saved; rerunning resumes from the last completed stage.");
  process.exit(1);
});
