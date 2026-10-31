import { spawn } from "node:child_process";
import path from "node:path";
import { StoppedError } from "./stop.js";

const MAX_OUTPUT = 20 * 1024 * 1024;

// Runs a child process without blocking the event loop.
// - `signal` stops it early (the Stop button)
// - `onStdout` / `onStderr` receive output as it streams (progress)
// stderr is attached to errors so failures are debuggable.
export function run(
  command,
  args,
  { timeoutMs = 30 * 60 * 1000, label, signal, onStdout, onStderr } = {}
) {
  const name = label || path.basename(command);
  if (signal?.aborted) return Promise.reject(new StoppedError());

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn(value);
    };

    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    const onAbort = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 3000).unref();
      finish(reject, new StoppedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
      onStdout?.(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-64 * 1024);
      onStderr?.(chunk);
    });

    child.on("error", (error) => {
      const reason =
        error.code === "ENOENT"
          ? `not found: "${command}" (is it installed / is PYTHON_BIN right?)`
          : error.message;
      finish(reject, new Error(`${name} ${reason}`));
    });

    child.on("close", (code) => {
      if (code === 0) return finish(resolve, stdout);
      // Progress bars use \r; keep only real lines for the error message.
      const tail = stderr
        .split(/[\r\n]+/)
        .filter((l) => l.trim() && !/^\s*\d{1,3}%\|/.test(l))
        .slice(-15)
        .join("\n");
      const reason = timedOut ? "timed out" : `exit code ${code}`;
      finish(reject, new Error(`${name} ${reason}${tail ? `:\n${tail}` : ""}`));
    });
  });
}
