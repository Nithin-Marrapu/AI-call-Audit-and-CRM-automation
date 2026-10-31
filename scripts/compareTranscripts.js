// Side-by-side: old setup (openai-whisper base, raw audio) vs current config.
// Usage: npm run compare -- <activityId | path/to/audio.mp3> [more...]
// Writes compare-*.txt next to each audio file.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../src/config/index.js";
import { preprocessAudio } from "../src/stages/preprocess.js";
import { transcribe } from "../src/stages/transcribe.js";

const inputs = process.argv.slice(2);
if (!inputs.length) {
  console.log("Usage: npm run compare -- <activityId | audio.mp3> [...]");
  process.exit(1);
}

async function resolveAudio(input) {
  const candidates = [input, path.join(config.paths.callsDir, input, "audio.mp3")];
  for (const p of candidates) {
    try {
      if ((await fs.stat(p)).isFile()) return path.resolve(p);
    } catch {}
  }
  throw new Error(`No audio found for "${input}"`);
}

// Copy into a scratch folder so outputs never mix with pipeline files.
async function workCopy(audio) {
  const name =
    path.basename(audio) === "audio.mp3"
      ? path.basename(path.dirname(audio)) // data/calls/<activityId>/audio.mp3
      : path.parse(audio).name;
  const dir = path.join(config.paths.dataDir, "compare", name);
  await fs.mkdir(dir, { recursive: true });
  const copy = path.join(dir, "audio.mp3");
  await fs.copyFile(audio, copy);
  return copy;
}

async function timed(fn) {
  const t = Date.now();
  const result = await fn();
  return { ...result, seconds: ((Date.now() - t) / 1000).toFixed(1) };
}

const stats = (r) =>
  `${r.meta.words} words | ${r.meta.segments} segments | ` +
  `avg logprob ${r.meta.avgLogprob} | ` +
  `${Math.round((r.meta.lowConfidenceShare ?? 0) * 100)}% low-confidence | ${r.seconds}s`;

for (const input of inputs) {
  const audio = await workCopy(await resolveAudio(input));
  console.log(`\n=== ${input} ===`);

  const old = await timed(() =>
    transcribe(audio, { backend: "openai", model: "base", prompt: "", outName: "old.json" })
  );

  const cleaned = config.audio.preprocess ? await preprocessAudio(audio) : audio;
  const current = await timed(() => transcribe(cleaned, { outName: "new.json" }));

  const report = [
    `OLD  (openai-whisper base, raw audio)`,
    stats(old),
    old.transcript || "(empty)",
    "",
    `NEW  (${config.whisper.backend}: ${config.whisper.model}${config.audio.preprocess ? ", cleaned audio" : ""})`,
    stats(current),
    current.transcript || "(empty)"
  ].join("\n");

  console.log(report);
  await fs.writeFile(path.join(path.dirname(audio), "compare.txt"), report);
}
