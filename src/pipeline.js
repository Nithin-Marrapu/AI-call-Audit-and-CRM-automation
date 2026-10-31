import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config/index.js";
import { STATUS } from "./db/jobStore.js";
import { preprocessAudio } from "./stages/preprocess.js";
import { transcribe } from "./stages/transcribe.js";
import { analyze } from "./stages/analyze.js";
import { validateAnalysis } from "./stages/validate.js";
import { syncToCrm } from "./stages/sync.js";
import { log as defaultLog } from "./lib/log.js";
import { StoppedError, checkStop } from "./lib/stop.js";

const ORDER = [
  STATUS.DISCOVERED,
  STATUS.DOWNLOADED,
  STATUS.TRANSCRIBED,
  STATUS.ANALYZED,
  STATUS.SYNCED
];

const done = (job, stage) => ORDER.indexOf(job.stage) >= ORDER.indexOf(stage);

// Share of the overall bar each step covers (transcribing and analyzing
// take almost all the time).
const BAR = {
  download: [0.02, 0.1],
  clean: [0.1, 0.14],
  transcribe: [0.14, 0.62],
  analyze: [0.62, 0.95],
  save: [0.95, 1]
};
const report = (log, step, fraction = 0) => {
  const [from, to] = BAR[step];
  log.progress?.(from + (to - from) * Math.max(0, Math.min(1, fraction)), step);
};

export function callDir(activityId) {
  // Activity IDs are GUIDs; strip anything else to keep paths safe.
  const safe = String(activityId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(config.paths.callsDir, safe);
}

const mmss = (s) => {
  const n = Number(s);
  return Number.isFinite(n) ? `${Math.floor(n / 60)}m ${String(Math.round(n % 60)).padStart(2, "0")}s` : "?";
};

// Writes a call's analysis to the CRM. Uses the reviewer's version when
// there is one. Safe to retry: finished CRM writes are not repeated.
export async function syncCall(store, activityId, { crm, log = defaultLog }) {
  const job = store.get(activityId);
  if (!job) throw new Error(`Unknown call ${activityId}`);
  if (job.stage === STATUS.SYNCED) return job;
  if (!done(job, STATUS.ANALYZED)) throw new Error("Call has not been analyzed yet.");

  try {
    log.step(`Updating ${crm.label}`);
    report(log, "save");
    const result = await syncToCrm(job.finalAnalysis ?? job.analysis, job, {
      crm,
      done: job.crmResponse ?? {},
      save: (progress) => store.saveCrmProgress(activityId, progress)
    });
    log.ok(
      `${result.fieldsUpdated.length ? result.fieldsUpdated.join(", ") : "no lead fields"} updated; ` +
        "audit added to lead notes"
    );
    store.advance(activityId, STATUS.SYNCED, { crmResponse: result });
    report(log, "save", 1);
    return store.get(activityId);
  } catch (error) {
    store.markFailed(activityId, error);
    throw error;
  }
}

// Runs one call through every remaining stage, resuming from the
// last completed one. Each call gets its own folder, so runs never
// overwrite each other's audio or transcripts.
// With reviewMode on, it stops after analysis and waits for approval.
export async function processCall(store, activityId, { crm, reviewMode = false, log = defaultLog, signal }) {
  let job = store.get(activityId);
  if (!job) throw new Error(`Unknown call ${activityId}`);

  if (job.stage === STATUS.SYNCED) {
    log.info(`Call ${activityId} already synced; skipping.`);
    return job;
  }

  const dir = callDir(activityId);
  const audioPath = path.join(dir, "audio.mp3");
  await fs.mkdir(dir, { recursive: true });

  try {
    checkStop(signal);
    if (!done(job, STATUS.DOWNLOADED)) {
      log.step("Downloading recording");
      report(log, "download");
      const bytes = await crm.fetchRecording(job, audioPath, { signal });
      log.ok(`${(bytes / 1024).toFixed(0)} KB`);
      store.advance(activityId, STATUS.DOWNLOADED);
    }

    checkStop(signal);
    job = store.get(activityId);
    if (!done(job, STATUS.TRANSCRIBED)) {
      let input = audioPath;
      if (config.audio.preprocess) {
        log.step("Cleaning audio (16 kHz, filtered)");
        report(log, "clean");
        input = await preprocessAudio(audioPath, { signal });
      }
      log.step(`Transcribing (${config.whisper.backend}: ${config.whisper.model})`);
      report(log, "transcribe");
      const { transcript, meta } = await transcribe(input, {
        signal,
        onProgress: (f) => report(log, "transcribe", f)
      });
      log.ok(
        `${meta.words} words, ${meta.segments} segments, ` +
          `${Math.round((meta.lowConfidenceShare ?? 0) * 100)}% low-confidence`
      );
      store.advance(activityId, STATUS.TRANSCRIBED, { transcript, transcriptMeta: meta });
    }

    checkStop(signal);
    job = store.get(activityId);
    if (!done(job, STATUS.ANALYZED)) {
      log.step(`Analyzing (${config.llm.model})`);
      report(log, "analyze");
      const { analysis: raw, attempts } = await analyze(job.transcript, {
        signal,
        onProgress: (f) => report(log, "analyze", f)
      });
      const { analysis, corrections } = validateAnalysis(raw, job.transcript);
      await fs.writeFile(path.join(dir, "analysis.json"), JSON.stringify(analysis, null, 2));
      log.ok(
        `${analysis.call_type} / ${analysis.outcome}` +
          (attempts > 1 ? ` (took ${attempts} model attempts)` : "") +
          (corrections.length ? ` — ${corrections.length} rule correction(s)` : "")
      );
      store.advance(activityId, STATUS.ANALYZED, { rawAnalysis: raw, analysis, corrections });
    }
    // Last chance to stop: CRM writes are never interrupted halfway.
    checkStop(signal);
  } catch (error) {
    if (error.stopped || signal?.aborted) {
      store.markStopped(activityId);
      log.info("Stopped. Progress is kept; retry to continue from here.");
      throw new StoppedError();
    }
    store.markFailed(activityId, error);
    throw error;
  }

  job = store.get(activityId);
  if (crm.writesToCrm === false) {
    log.ok("Analysis saved in the app (not linked to a CRM lead)");
    report(log, "save", 1);
    return job;
  }
  if (reviewMode && !job.reviewAction) {
    store.markReview(activityId);
    log.ok("Waiting for review before anything is sent to the CRM");
    report(log, "save", 1);
    return store.get(activityId);
  }

  return syncCall(store, activityId, { crm, log });
}

// Picks the newest recorded call that is long enough to show the lead's
// intent (default 7 min). Shorter calls are listed but not processed.
export function pickCall(calls, minSeconds) {
  return calls.find((c) => Number(c.duration) >= minSeconds) ?? null;
}

export async function processLead(
  store,
  leadId,
  { crm, force = false, minSeconds = config.minCallSeconds, reviewMode = false, log = defaultLog, signal }
) {
  checkStop(signal);
  log.step(`Finding recorded calls for lead ${leadId} in ${crm.label}`);
  const calls = await crm.listRecordedCalls(leadId);

  if (calls.length === 0) {
    const s = calls.summary;
    throw new Error(
      !s
        ? "No recorded calls found for this lead."
        : s.calls === 0
          ? "This lead has no phone calls in the CRM."
          : `This lead has ${s.calls} phone call${s.calls === 1 ? "" : "s"}, but none has a recording link. ` +
            "Check that call recording is on for your telephony integration."
    );
  }

  const chosen = pickCall(calls, minSeconds);
  const skipped = calls.filter(
    (c) => c !== chosen && (!chosen || new Date(c.createdOn) > new Date(chosen.createdOn))
  );

  log.ok(`${calls.length} recorded call(s); minimum length ${mmss(minSeconds)}`);
  for (const c of skipped.slice(0, 5)) {
    log.info(`  skip ${String(c.activityId).slice(0, 8)}  ${c.createdOn}  ${mmss(c.duration)}  (too short)`);
  }

  if (!chosen) {
    log.info("No call on this lead is long enough to audit. Nothing sent to the CRM.");
    return null;
  }

  log.ok(`Auditing ${chosen.activityId} (${chosen.createdOn}, ${mmss(chosen.duration)})`);

  // The CRM's name for the lead, not the one heard on the call. A failed
  // lookup never stops the audit.
  let leadName = null;
  try {
    leadName = (await crm.getLeadName?.(leadId)) ?? null;
    if (leadName) log.info(`Lead: ${leadName}`);
  } catch {
    // name stays empty; the list falls back to the AI's or the ID
  }

  let job = store.upsertDiscovered({ ...chosen, crm: crm.id, leadName });

  if (force) {
    store.reset(chosen.activityId);
    job = store.get(chosen.activityId);
  }

  // Some CRMs (the Demo CRM) hand us the transcript directly.
  if (chosen.transcript && !done(job, STATUS.TRANSCRIBED)) {
    store.advance(chosen.activityId, STATUS.TRANSCRIBED, {
      transcript: chosen.transcript,
      transcriptMeta: { backend: "crm", model: "provided by CRM", words: chosen.transcript.split(/\s+/).length }
    });
    job = store.get(chosen.activityId);
  }

  if (job.stage === STATUS.SYNCED) {
    log.info("Already processed — no duplicate CRM update. Use --force to redo.");
    return job;
  }
  if (job.status === STATUS.REJECTED) {
    log.info("This call's analysis was rejected in review. Use --force to redo.");
    return job;
  }
  if (job.status === STATUS.REVIEW) {
    log.info("Already analyzed; waiting for review.");
    return job;
  }

  if (job.attempts >= config.maxAttempts) {
    throw new Error(
      `Call ${chosen.activityId} failed ${job.attempts} times (last: ${job.lastError}). ` +
        "Fix the cause, then run `retry` on it."
    );
  }

  return processCall(store, chosen.activityId, { crm, reviewMode, log, signal });
}
