// Groups objections into themes. The AI words each one differently
// ("fee too high", "expected 50k", "can't afford"), so counting the exact
// text would show every objection once. Themes are matched by keywords;
// `search` is the word the Calls page filters on when a theme is clicked.
// Order matters: the first matching theme wins, most specific first.
export const THEMES = [
  { id: "family", label: "Family decision", search: "parents", words: ["parent", "father", "mother", "family", "wife", "husband", "discuss with", "ask my"] },
  { id: "fees", label: "Fees and price", search: "fee", words: ["fee", "price", "cost", "afford", "expensive", "emi", "budget", "money", "pay", "loan", "discount", "thousand", "lakh"] },
  { id: "time", label: "Time and schedule", search: "time", words: ["time", "busy", "schedule", "hours", "long", "duration", "months", "weekend", "job hours", "workload", "child", "kid"] },
  { id: "placement", label: "Placement and jobs", search: "placement", words: ["placement", "job guarantee", "guarantee", "job", "salary", "hiring", "interview"] },
  { id: "difficulty", label: "Background and difficulty", search: "background", words: ["background", "non-tech", "non tech", "technical", "difficult", "keep up", "coding", "understand", "beginner", "maths", "math"] },
  { id: "trust", label: "Certificate and trust", search: "certificate", words: ["certificate", "university", "recogni", "trust", "review", "valid", "accredit", "legit"] },
  { id: "timing", label: "Not right now", search: "later", words: ["later", "not now", "next year", "not interested", "not ready", "think about", "will call", "call back"] }
];

export function themeOf(text) {
  const t = ` ${String(text || "").toLowerCase()} `;
  return THEMES.find((theme) => theme.words.some((w) => t.includes(w)))?.id ?? "other";
}

// Counts each theme at most once per call, over calls from the last `days`.
export function topObjections(jobs, { days = 7, now = Date.now() } = {}) {
  const since = now - days * 86400000;
  const counts = new Map();
  const examples = new Map();
  let calls = 0;

  for (const j of jobs) {
    const a = j.finalAnalysis ?? j.analysis;
    if (!a?.objections?.length) continue;
    const when = Date.parse(String(j.createdOn || j.firstSeenAt || "").replace(" ", "T") + (j.createdOn ? "Z" : ""));
    if (Number.isFinite(when) && when < since) continue;
    calls++;
    const seen = new Set();
    for (const o of a.objections) {
      const id = themeOf(o.concern);
      if (seen.has(id)) continue;
      seen.add(id);
      counts.set(id, (counts.get(id) || 0) + 1);
      if (!examples.has(id)) examples.set(id, o.concern);
    }
  }

  const rows = [...counts.entries()]
    .map(([id, count]) => {
      const theme = THEMES.find((t) => t.id === id);
      return {
        id,
        label: theme?.label ?? "Other",
        search: theme?.search ?? null,
        count,
        example: examples.get(id)
      };
    })
    .sort((a, b) => b.count - a.count || (a.id === "other") - (b.id === "other"));

  return { days, callsWithObjections: calls, themes: rows };
}
