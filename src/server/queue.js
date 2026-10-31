import { log as consoleLog } from "../lib/log.js";

// Runs jobs one at a time: Whisper and the LLM use the whole GPU, so
// running two calls in parallel would only make both slower.
export class JobQueue {
  constructor({ keep = 50 } = {}) {
    this.jobs = [];
    this.keep = keep;
    this.nextId = 1;
    this.tail = Promise.resolve();
    this.controllers = new Map();
  }

  add(label, meta, fn) {
    const job = {
      id: String(this.nextId++),
      label,
      ...meta,
      state: "queued",
      logs: [],
      error: null,
      result: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      progress: 0,
      step: null
    };
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.jobs.unshift(job);
    this.jobs.length = Math.min(this.jobs.length, this.keep);

    const line = (level) => (msg) => {
      job.logs.push({ t: new Date().toISOString(), level, msg: String(msg) });
      consoleLog[level](msg);
    };
    const log = {
      step: line("step"),
      ok: line("ok"),
      info: line("info"),
      error: line("error"),
      // Never moves backwards (a model retry restarts its own estimate).
      progress: (fraction, step) => {
        const pct = Math.round(fraction * 100);
        if (pct >= job.progress) job.progress = pct;
        if (step) job.step = step;
      }
    };

    this.tail = this.tail.then(async () => {
      if (controller.signal.aborted) {
        job.state = "stopped";
        job.finishedAt = new Date().toISOString();
        this.controllers.delete(job.id);
        return;
      }
      job.state = "running";
      try {
        job.result = (await fn(log, controller.signal)) ?? null;
        job.state = "done";
        job.progress = 100;
      } catch (error) {
        if (error.stopped || controller.signal.aborted) {
          job.state = "stopped";
        } else {
          job.error = error.message;
          job.state = "failed";
          log.error(error.message);
        }
      } finally {
        job.finishedAt = new Date().toISOString();
        this.controllers.delete(job.id);
      }
    });

    return job;
  }

  // Stops a running job (kills Whisper / the LLM) or cancels a waiting one.
  stop(id) {
    const job = this.get(id);
    if (!job || !["queued", "running"].includes(job.state)) return false;
    const wasQueued = job.state === "queued";
    this.controllers.get(job.id)?.abort();
    if (wasQueued) {
      job.state = "stopped";
      job.logs.push({ t: new Date().toISOString(), level: "info", msg: "Cancelled before it started." });
    } else {
      job.stopping = true;
      job.logs.push({ t: new Date().toISOString(), level: "info", msg: "Stopping…" });
    }
    return true;
  }

  stopAll() {
    return this.jobs.filter((j) => this.stop(j.id)).length;
  }

  get(id) {
    return this.jobs.find((j) => j.id === String(id)) ?? null;
  }

  list() {
    return this.jobs;
  }

  busy() {
    return this.jobs.some((j) => j.state === "queued" || j.state === "running");
  }
}
