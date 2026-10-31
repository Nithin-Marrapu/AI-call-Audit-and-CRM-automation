export function duration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return "–";
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  return m ? `${m}:${String(r).padStart(2, "0")}` : `0:${String(r).padStart(2, "0")}`;
}

// CRM timestamps are UTC "YYYY-MM-DD HH:mm:ss"; show in local time.
export function when(value) {
  if (!value) return "–";
  const d = new Date(/Z|T/.test(value) ? value : String(value).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return value;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

export const label = (value) =>
  value == null ? "–" : String(value).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export const STATUS_TEXT = {
  discovered: "Queued",
  downloaded: "Downloaded",
  transcribed: "Transcribed",
  analyzed: "Analyzed",
  review: "Needs review",
  synced: "Sent to CRM",
  rejected: "Rejected",
  stopped: "Stopped",
  failed: "Failed"
};
