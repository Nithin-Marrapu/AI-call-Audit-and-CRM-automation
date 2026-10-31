const time = () => new Date().toISOString().slice(11, 19);

export const log = {
  step: (msg) => console.log(`${time()} → ${msg}...`),
  ok: (msg) => console.log(`${time()}   ✓ ${msg}`),
  info: (msg) => console.log(`${time()}   ${msg}`),
  error: (msg) => console.error(`${time()} ✗ ${msg}`),
  // Overall progress 0-1 for the web app; the CLI ignores it.
  progress: () => {}
};
