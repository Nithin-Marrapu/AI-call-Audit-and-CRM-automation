import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JobStore } from "../src/db/jobStore.js";
import { createApp } from "../src/server/app.js";
import { config } from "../src/config/index.js";

// A "model" that takes 30 s unless the FAST file exists.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stop-"));
const fast = path.join(tmp, "FAST");
const llm = fileURLToPath(new URL("./fixtures/fake-llm.sh", import.meta.url));
const slowPy = path.join(tmp, "slow.sh");
fs.writeFileSync(slowPy, `#!/bin/bash\n[ -f "${fast}" ] || sleep 30\nexec "${llm}"\n`);
fs.chmodSync(slowPy, 0o755);
config.python = slowPy;
config.paths.callsDir = path.join(tmp, "calls");

let server, base, store;
before(async () => {
  store = new JobStore(":memory:");
  store.saveSettings({ crm: "demo", reviewMode: true });
  server = createApp(store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = async (p, body = {}) => {
  const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const get = async (p) => (await fetch(base + p)).json();
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting");
};

test("Stop kills a running analysis; waiting jobs are cancelled; the call can be resumed", async () => {
  const a = (await post("/api/process", { leadId: "demo-lead-priya" })).body;
  const b = (await post("/api/process", { leadId: "demo-lead-arjun" })).body;

  // Wait until the slow model is actually running for job a.
  await until(async () => (await get(`/api/jobs/${a.id}`)).logs.some((l) => /Analyzing/.test(l.msg)));

  const t0 = Date.now();
  const stopped = await post("/api/jobs/stop-all");
  assert.equal(stopped.body.stopped, 2);

  const ja = await until(async () => {
    const j = await get(`/api/jobs/${a.id}`);
    return j.state === "stopped" && j;
  });
  assert.ok(Date.now() - t0 < 3000, "stopped quickly, not after the 30 s model run");
  assert.equal(ja.error, null, "a stop is not an error");

  const jb = await get(`/api/jobs/${b.id}`);
  assert.equal(jb.state, "stopped");
  assert.ok(jb.logs.some((l) => /Cancelled before it started/.test(l.msg)));

  const call = await get("/api/calls/demo-call-priya-1");
  assert.equal(call.status, "stopped");
  assert.equal(call.stage, "transcribed", "progress kept");
  assert.equal(call.attempts, 0, "not counted as a failure");
  assert.equal(await store.get("demo-call-arjun-1"), null, "cancelled job never started");

  // Stopping a finished job is refused.
  assert.equal((await post(`/api/jobs/${a.id}/stop`)).status, 400);

  // Resume: retry continues from the transcript and reaches review.
  fs.writeFileSync(fast, "");
  const r = (await post("/api/calls/demo-call-priya-1/retry")).body;
  const jr = await until(async () => {
    const j = await get(`/api/jobs/${r.id}`);
    return ["done", "failed"].includes(j.state) && j;
  });
  assert.equal(jr.state, "done", jr.error);
  assert.equal(jr.result.status, "review");
});
