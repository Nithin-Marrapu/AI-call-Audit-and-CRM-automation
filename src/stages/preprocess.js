import path from "node:path";
import { run } from "../lib/exec.js";

// Phone recordings arrive as 8 kHz, 8 kbps mono MP3. Whisper works at
// 16 kHz, so we resample once here, cut low-frequency line hum and
// even out volume between a loud agent and a quiet customer.
export const AUDIO_FILTER = [
  "highpass=f=100",
  "lowpass=f=3800",
  "dynaudnorm=f=150:g=15"
].join(",");

export async function preprocessAudio(inputPath, { signal } = {}) {
  const outputPath = path.join(path.dirname(inputPath), "audio.wav");

  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-af",
      AUDIO_FILTER,
      outputPath
    ],
    { timeoutMs: 5 * 60 * 1000, label: "ffmpeg (audio cleanup)", signal }
  );

  return outputPath;
}

// Converts any uploaded audio (wav, m4a, ogg, mp3...) to a standard mp3
// so it plays in the browser and goes through the same pipeline.
export async function convertUpload(inputPath, outputPath) {
  await run(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", outputPath],
    { timeoutMs: 10 * 60 * 1000, label: "ffmpeg (convert upload)" }
  );
}

export async function audioDuration(filePath) {
  const out = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath],
    { timeoutMs: 60 * 1000, label: "ffprobe" }
  );
  const seconds = Number(String(out).trim());
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}
