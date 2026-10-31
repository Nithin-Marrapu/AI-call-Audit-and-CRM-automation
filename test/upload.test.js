import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JobStore } from "../src/db/jobStore.js";
import { createApp } from "../src/server/app.js";
import { config } from "../src/config/index.js";

// Fake Whisper + LLM: one script answers both calls.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "upload-"));
const fakePy = path.join(tmp, "fake-py.sh");
const llm = fileURLToPath(new URL("./fixtures/fake-llm.sh", import.meta.url));
fs.writeFileSync(
  fakePy,
  `#!/bin/bash
case "$1" in
  *transcribe.py)
    cat > "$3" <<'J'
{"backend":"mlx","model":"m","language":"en","segments":[
 {"start":0,"end":4,"text":"I want to move into a data analyst role where I can work with dashboards and SQL.","avg_logprob":-0.3,"no_speech_prob":0.01},
 {"start":5,"end":8,"text":"Seven thousand a month is manageable for me.","avg_logprob":-0.4,"no_speech_prob":0.01}]}
J
  ;;
  *) exec "${llm}" ;;
esac
`
);
fs.chmodSync(fakePy, 0o755);
config.python = fakePy;
config.paths.callsDir = path.join(tmp, "calls");

const wav = path.join(tmp, "call.wav");
execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=f=300:d=3", wav]);

let server, base, store;
before(async () => {
  store = new JobStore(":memory:");
  store.saveSettings({ crm: "demo", reviewMode: true });
  server = createApp(store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const upload = (query, body, type = "audio/wav") =>
  fetch(`${base}/api/upload?${new URLSearchParams(query)}`, { method: "POST", headers: { "Content-Type": type }, body });

async function waitForJob(id) {
  for (let i = 0; i < 200; i++) {
    const j = await (await fetch(`${base}/api/jobs/${id}`)).json();
    if (j.state === "done" || j.state === "failed") return j;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timeout");
}

test("upload without a lead: analyzed and kept in the app", async () => {
  const res = await upload({ filename: "priya-call.wav", name: "Priya test" }, fs.readFileSync(wav));
  assert.equal(res.status, 202);
  const job = await waitForJob((await res.json()).id);
  assert.equal(job.state, "done", job.error);
  assert.equal(job.result.status, "analyzed");
  assert.equal(job.result.crm, "upload");
  assert.equal(job.result.duration, 3);

  const detail = await (await fetch(`${base}/api/calls/${job.result.activityId}`)).json();
  assert.equal(detail.hasAudio, true);
  assert.match(detail.transcript, /\[0:00\] I want to move/);
  assert.equal(detail.analysis.interest_level, "hot");
  assert.equal(detail.leadName, "Priya test");
});

test("upload linked to a CRM lead: goes to review, approve writes the note", async () => {
  const res = await upload({ filename: "x.wav", leadId: "demo-lead-priya" }, fs.readFileSync(wav));
  const job = await waitForJob((await res.json()).id);
  assert.equal(job.result.status, "review");
  const ok = await fetch(`${base}/api/calls/${job.result.activityId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(ok.status, 200);
  const lead = await (await fetch(`${base}/api/crm/leads/demo-lead-priya`)).json();
  assert.equal(lead.notes.length, 1);
});

test("upload rejects empty and non-audio files", async () => {
  assert.equal((await upload({}, Buffer.alloc(0))).status, 400);
  const bad = await upload({ filename: "notes.txt" }, Buffer.from("hello, this is not audio"), "text/plain");
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /isn't audio/);
});
