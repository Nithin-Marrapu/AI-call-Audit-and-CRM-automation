import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { run } from "../lib/exec.js";

const SCRIPT = fileURLToPath(new URL("../../py/transcribe.py", import.meta.url));

// Whisper's confidence per segment: avg_logprob below about -1.0
// usually means it was guessing.
const LOW_CONFIDENCE_LOGPROB = -1.0;

const fmt = (seconds) => {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function segmentsToTranscript(segments) {
  return segments.map((s) => `[${fmt(s.start)}] ${s.text}`).join("\n");
}

// Whisper's progress bar looks like " 45%|████▌     | 1350/3000 [...]".
export function parseWhisperProgress(chunk) {
  const matches = [...String(chunk).matchAll(/(\d{1,3})%\|/g)];
  if (!matches.length) return null;
  return Math.min(100, Number(matches.at(-1)[1]));
}

export function transcriptStats(segments) {
  if (!segments.length) {
    return { segments: 0, words: 0, avgLogprob: null, lowConfidenceShare: null };
  }
  const words = segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  const avg = segments.reduce((n, s) => n + s.avg_logprob, 0) / segments.length;
  const low = segments.filter((s) => s.avg_logprob < LOW_CONFIDENCE_LOGPROB).length;
  return {
    segments: segments.length,
    words,
    avgLogprob: Number(avg.toFixed(3)),
    lowConfidenceShare: Number((low / segments.length).toFixed(2))
  };
}

// Transcribes one (preprocessed) audio file.
// `overrides` lets the compare script try other backends/models.
export async function transcribe(audioPath, overrides = {}) {
  const opts = { ...config.whisper, ...overrides };
  const outPath = path.join(
    path.dirname(audioPath),
    overrides.outName || "segments.json"
  );

  const args = [
    SCRIPT,
    audioPath,
    outPath,
    "--backend",
    opts.backend,
    "--model",
    opts.model,
    "--language",
    opts.language || "auto"
  ];
  if (opts.prompt) args.push("--prompt", opts.prompt);

  await run(config.python, args, {
    label: `whisper (${opts.backend})`,
    signal: overrides.signal,
    onStderr: (chunk) => {
      const pct = parseWhisperProgress(chunk);
      if (pct !== null) overrides.onProgress?.(pct / 100);
    }
  });

  const result = JSON.parse(await fs.readFile(outPath, "utf8"));
  const segments = result.segments || [];

  return {
    transcript: segmentsToTranscript(segments),
    segments,
    meta: {
      backend: result.backend,
      model: result.model,
      language: result.language,
      ...transcriptStats(segments)
    }
  };
}
