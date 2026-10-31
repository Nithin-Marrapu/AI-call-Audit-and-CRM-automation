import fs from "node:fs/promises";
import { StoppedError } from "../lib/stop.js";

export async function downloadRecording(resourceUrl, destination, { signal } = {}) {
  const timeout = AbortSignal.timeout(5 * 60 * 1000);
  let response;
  try {
    response = await fetch(resourceUrl, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
  } catch (error) {
    if (signal?.aborted) throw new StoppedError();
    throw new Error(`Recording download failed (${error.cause?.code || error.message})`);
  }

  if (!response.ok) {
    throw new Error(`Recording download failed: HTTP ${response.status}`);
  }

  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    if (signal?.aborted) throw new StoppedError();
    throw error;
  }

  if (buffer.length === 0) {
    throw new Error("Recording download returned an empty file.");
  }

  // Write to a temp name first so a crash never leaves a half file
  // that a later run would treat as complete.
  const tmp = `${destination}.part`;
  await fs.writeFile(tmp, buffer);
  await fs.rename(tmp, destination);

  return buffer.length;
}
