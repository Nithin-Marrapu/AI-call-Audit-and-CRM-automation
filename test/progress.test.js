import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JobStore } from "../src/db/jobStore.js";
import { createApp } from "../src/server/app.js";
import { config } from "../src/config/index.js";
import { run } from "../src/lib/exec.js";
import { parseWhisperProgress } from "../src/stages/transcribe.js";

test("parseWhisperProgress reads the last percentage in a chunk", () => {
  assert.equal(parseWhisperProgress("\r 12%|█▏   | 360/3000 [00:02<00:15]\r 45%|████▌| 1350/3000"), 45);
  assert.equal(parseWhisperProgress("Detected language: English"), null);
  assert.equal(parseWhisperProgress("100%|██████████| 3000/3000"), 100);
});

test("run streams output and reports failures with stderr", async () => {
  const seen = [];
  const out = await run("bash", ["-c", "echo a; sleep 0.1; echo b; echo 30%\\| >&2"], {
    onStdout: (c) => seen.push(c),
    onStderr: (c) => seen.push(`err:${c.trim()}`)
  });
  assert.equal(out, "a\nb\n");
  assert.ok(seen.length >= 2, "output arrived in pieces");
  await assert.rejects(run("bash", ["-c", "echo broken >&2; exit 3"], { label: "tool" }), /tool exit code 3:\nbroken/);
  await assert.rejects(run("/no/such/binary", []), /not found/);
});

test("progress moves through transcribe and analyze, never backwards, ends at 100", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prog-"));
  const llm = fileURLToPath(new URL("./fixtures/fake-llm.sh", import.meta.url));
  const py = path.join(tmp, "py.sh");
  fs.writeFileSync(
    py,
    `#!/bin/bash
case "$1" in
  *transcribe.py)
    for p in 10 35 60 85 100; do printf "\\r %3d%%|#####| %d/100" $p $p >&2; sleep 0.15; done
    echo '{"segments":[{"start":0,"end":3,"text":"I want to move into a data analyst role where I can work with dashboards and SQL.","avg_logprob":-0.2}]}' > "$3"
    ;;
  *)
    "${llm}" | while IFS= read -r line; do echo "$line"; sleep 0.08; done
    ;;
esac
`
  );
  fs.chmodSync(py, 0o755);
  config.python = py;
  config.paths.callsDir = path.join(tmp, "calls");
  const wav = path.join(tmp, "a.wav");
  execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=d=2", wav]);

  const store = new JobStore(":memory:");
  store.saveSettings({ crm: "demo", reviewMode: false });
  const server = createApp(store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { id } = await (
    await fetch(`${base}/api/upload?filename=a.wav`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: fs.readFileSync(wav) })
  ).json();

  const samples = [];
  let job;
  for (let i = 0; i < 400; i++) {
    job = await (await fetch(`${base}/api/jobs/${id}`)).json();
    samples.push([job.progress, job.step]);
    if (job.state === "done" || job.state === "failed") break;
    await new Promise((r) => setTimeout(r, 25));
  }
  server.close();

  assert.equal(job.state, "done", job.error);
  assert.equal(job.progress, 100);
  const pcts = samples.map((s) => s[0]);
  assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b), "never goes backwards");
  assert.ok(samples.some(([p, s]) => s === "transcribe" && p > 20 && p < 62), "real transcription progress shown");
  assert.ok(samples.some(([p, s]) => s === "analyze" && p > 62 && p < 96), "analysis progress shown");
});
