import { createCrm } from "./crm/index.js";
import { loadSettings } from "./settings.js";
import { processLead } from "./pipeline.js";
import { DISPOSITION_DEFAULTS, DispositionStore, OUTCOME_TEXT, applyOutcome, decideOutcome } from "./disposition.js";

// The watcher finds new recorded calls on its own, so nobody has to
// paste a lead ID. Every few minutes it asks the CRM for phone calls
// since the last check and queues the long ones for an audit.
//
// Recordings can reach the CRM a few minutes after the call, so each
// check looks back a little before the last one, and a call without a
// recording is checked again until it is RECORDING_WAIT_MS old.

const OVERLAP_MS = 15 * 60 * 1000;
const RECORDING_WAIT_MS = 45 * 60 * 1000;
const FIRST_LOOKBACK_MS = 30 * 60 * 1000;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const KEEP_SEEN_MS = 2 * 24 * 60 * 60 * 1000;
const KEEP_EVENTS = 50;
const MAX_LOOKBACK_HOURS = 72;
// Each audit takes a minute or two, so one check queues at most this many.
const MAX_QUEUE_PER_CHECK = 10;

export const dispositionConfig = (settings) => ({
  ...DISPOSITION_DEFAULTS,
  ...(settings.disposition || {}),
  values: { ...DISPOSITION_DEFAULTS.values, ...(settings.disposition?.values || {}) }
});

export const WATCHER_DEFAULTS = { enabled: false, intervalMinutes: 3 };

const parseUtc = (v) => (v ? Date.parse(String(v).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? "" : "Z")) : NaN);

export class Watcher {
  constructor(store, queue, { now = () => Date.now(), crmFor = (s) => createCrm(s, store) } = {}) {
    this.store = store;
    this.dispositions = new DispositionStore(store.db);
    this.queue = queue;
    this.now = now;
    this.crmFor = crmFor;
    this.timer = null;
    this.checking = null;
    this.seen = new Map(); // activityId -> time decided
    this.events = [];
    this.lastCheck = null;
    this.lastError = null;
    this.day = null;
    this.today = { checks: 0, found: 0, queued: 0, short: 0, noRecording: 0, already: 0, outcomes: 0, pending: 0 };
  }

  config() {
    return { ...WATCHER_DEFAULTS, ...(this.store.getSettings().watcher || {}) };
  }

  // Starts the timer if the watcher was left on (called at server start).
  resume() {
    if (this.config().enabled) this.schedule(5000);
  }

  setConfig(update = {}) {
    const next = { ...this.config() };
    if (update.enabled !== undefined) next.enabled = update.enabled === true;
    if (update.intervalMinutes !== undefined) {
      const n = Number(update.intervalMinutes);
      if (!Number.isFinite(n) || n < 1 || n > 60) throw new Error("intervalMinutes must be 1-60");
      next.intervalMinutes = n;
    }
    const wasOn = this.config().enabled;
    this.store.saveSettings({ watcher: next });
    if (next.enabled && !wasOn) {
      // Start from now: turning it on doesn't audit yesterday's calls.
      this.store.saveSettings({ watcherCursor: new Date(this.now() - FIRST_LOOKBACK_MS).toISOString() });
      this.schedule(0);
    } else if (!next.enabled) {
      this.stop();
    } else {
      this.schedule(next.intervalMinutes * 60000);
    }
    return this.status();
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.nextCheck = new Date(this.now() + ms).toISOString();
    this.timer = setTimeout(async () => {
      await this.check().catch(() => {});
      if (this.config().enabled) this.schedule(this.config().intervalMinutes * 60000);
    }, ms);
    this.timer.unref?.();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.nextCheck = null;
  }

  event(type, text, extra = {}) {
    this.events.unshift({ t: new Date(this.now()).toISOString(), type, text, ...extra });
    this.events.length = Math.min(this.events.length, KEEP_EVENTS);
  }

  count(key, n = 1) {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.today = { checks: 0, found: 0, queued: 0, short: 0, noRecording: 0, already: 0, outcomes: 0, pending: 0 };
    }
    this.today[key] += n;
  }

  // One check. Runs at most one at a time; a second call waits for it.
  // `lookbackHours` checks further back once (to test on past calls)
  // without moving the cursor backwards.
  check({ lookbackHours } = {}) {
    if (!this.checking) this.checking = this.#check(lookbackHours).finally(() => (this.checking = null));
    return this.checking;
  }

  async #check(lookbackHours) {
    const settings = loadSettings(this.store);
    const crm = this.crmFor(settings);
    const to = this.now();
    const cursor = parseUtc(settings.watcherCursor) || to - FIRST_LOOKBACK_MS;
    const from = lookbackHours
      ? to - Math.min(Number(lookbackHours), MAX_LOOKBACK_HOURS) * 3600000
      : Math.max(cursor - OVERLAP_MS, to - MAX_WINDOW_MS);
    const minSeconds = settings.minCallMinutes * 60;
    this.count("checks");

    try {
      if (!crm.listCallsSince) throw new Error(`${crm.label} can't list new calls, so the watcher can't run on it.`);
      const found = (await crm.listCallsSince(new Date(from), new Date(to))).filter((c) => !this.seen.has(c.activityId));

      // Group by lead: one CRM request per lead gives every call's details.
      const byLead = new Map();
      for (const c of found) byLead.set(c.leadId, [...(byLead.get(c.leadId) || []), c]);

      const queued = [];
      let left = 0;
      const dcfg = dispositionConfig(settings);
      for (const [leadId, items] of byLead) {
        // All calls, answered or not (unanswered ones have no recording).
        const calls = crm.listCalls ? await crm.listCalls(leadId) : await crm.listRecordedCalls(leadId);
        let leadName;
        const name = async () => (leadName ??= (await crm.getLeadName?.(leadId).catch(() => null)) ?? null);

        for (const item of items) {
          const call = calls.find((c) => c.activityId === item.activityId);
          const age = to - (parseUtc(item.createdOn) || to);
          const job = this.store.get(item.activityId);

          if (job) {
            this.decide(item, "already");
            await this.outcome(crm, dcfg, { ...item, ...call }, { analysis: job.finalAnalysis ?? job.analysis, leadName: job.leadName });
          } else if (!call || !call.resourceUrl) {
            // No recording: an unanswered call never gets one; an answered
            // call's recording can arrive late, so wait for it a while.
            const waiting = call ? decideOutcome(call).outcome === "answered" : true;
            if (waiting && age <= RECORDING_WAIT_MS) continue;
            this.decide(item, "noRecording");
            if (call) await this.outcome(crm, dcfg, call, { leadName: await name() });
          } else if (Number(call.duration) < minSeconds) {
            this.decide(item, "short");
            await this.outcome(crm, dcfg, call, { leadName: await name() });
          } else if (queued.length >= MAX_QUEUE_PER_CHECK) {
            left++; // not marked seen: the next check picks it up
          } else {
            this.decide(item, "queued");
            queued.push(this.enqueue(crm, settings, call));
          }
        }
      }

      this.count("found", found.length);
      if (!lookbackHours || to > cursor) this.store.saveSettings({ watcherCursor: new Date(Math.max(to, cursor)).toISOString() });
      if (lookbackHours) this.event("check", `Checked the last ${lookbackHours} h: ${found.length} new call(s), ${queued.length} queued` + (left ? `, ${left} more next time` : ""));
      this.lastCheck = new Date(to).toISOString();
      this.lastError = null;
      this.prune(to);
      return { found: found.length, queued: queued.length, left };
    } catch (error) {
      this.lastCheck = new Date(to).toISOString();
      this.lastError = error.message;
      this.event("error", error.message);
      throw error;
    }
  }

  // Fills the lead's call outcome (e.g. "Phone Answered") for one call.
  async outcome(crm, dcfg, call, extra) {
    if (!call?.leadId) return null;
    // Switched off: the decision is still recorded (as a dry run) but
    // nothing is written to the CRM.
    const d = await applyOutcome(this.dispositions, crm, dcfg, call, extra);
    if (!dcfg.enabled) return d;
    const who = d.leadName || `lead ${String(call.leadId).slice(0, 8)}`;
    if (d.state === "written" && d.updatedAt === d.decidedAt) {
      this.count("outcomes");
      this.event("outcome", `${who}: ${dcfg.field} set to "${d.value}"`, { leadId: call.leadId });
    } else if (d.state === "pending" && d.updatedAt === d.decidedAt) {
      this.count("pending");
      this.event("pending", `${who}: unsure (${d.reason}), waiting for you`, { leadId: call.leadId });
    } else if (d.state === "failed") {
      this.event("error", `${who}: couldn't set ${dcfg.field}: ${d.error}`, { leadId: call.leadId });
    }
    return d;
  }

  decide(item, outcome) {
    this.seen.set(item.activityId, this.now());
    this.count(outcome);
  }

  enqueue(crm, settings, call) {
    const label = `Auto: lead ${call.leadId.slice(0, 8)}`;
    const job = this.queue.add(label, { leadId: call.leadId, activityId: call.activityId, crm: crm.id, auto: true }, async (log, signal) => {
      const done = await processLead(this.store, call.leadId, {
        crm,
        activityId: call.activityId,
        minSeconds: settings.minCallMinutes * 60,
        reviewMode: settings.reviewMode,
        log,
        signal
      });
      if (done) job.label = `Auto: ${done.leadName || label.slice(6)}`;
      // After the audit, the outcome can use what the AI heard.
      const fresh = this.store.get(call.activityId);
      await this.outcome(crm, dispositionConfig(loadSettings(this.store)), call, {
        analysis: fresh?.finalAnalysis ?? fresh?.analysis,
        leadName: fresh?.leadName
      }).catch(() => {});
      return done ? { activityId: done.activityId, status: done.status } : null;
    });
    this.event("queued", `Queued a ${Math.round(Number(call.duration) / 60)} min call`, {
      leadId: call.leadId,
      activityId: call.activityId,
      jobId: job.id
    });
    return job;
  }

  prune(now) {
    for (const [id, t] of this.seen) if (now - t > KEEP_SEEN_MS) this.seen.delete(id);
  }

  status() {
    const c = this.config();
    return {
      ...c,
      running: Boolean(this.timer),
      checking: Boolean(this.checking),
      lastCheck: this.lastCheck,
      nextCheck: c.enabled ? this.nextCheck : null,
      lastError: this.lastError,
      today: this.today,
      events: this.events
    };
  }
}
