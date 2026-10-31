import { STATUS_TEXT, duration, label } from "../format.js";

// The call length, drawn against the audit threshold. Calls under the
// line are too short to show the lead's intent and are never audited.
export function DurationBar({ seconds, minMinutes = 7, max = 15 * 60 }) {
  const s = Number(seconds) || 0;
  const scale = Math.max(max, s);
  const fill = Math.min(100, (s / scale) * 100);
  const mark = Math.min(100, ((minMinutes * 60) / scale) * 100);
  const short = s < minMinutes * 60;
  return (
    <div className="duration" title={`${duration(s)}, audit threshold ${minMinutes} min`}>
      <span className="duration-num">{duration(s)}</span>
      <span className="duration-track" aria-hidden="true">
        <span className={`duration-fill ${short ? "is-short" : ""}`} style={{ width: `${fill}%` }} />
        <span className="duration-mark" style={{ left: `${mark}%` }} />
      </span>
    </div>
  );
}

export function StatusChip({ status }) {
  return <span className={`chip chip-${status}`}>{STATUS_TEXT[status] ?? label(status)}</span>;
}

export function Interest({ level, withText = true }) {
  if (!level || level === "unknown") return <span className="muted">–</span>;
  return (
    <span className={`interest interest-${level}`}>
      <span className="interest-dot" aria-hidden="true" />
      {withText && label(level)}
    </span>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return (
    <p className="error-note" role="alert">
      {children}
    </p>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
