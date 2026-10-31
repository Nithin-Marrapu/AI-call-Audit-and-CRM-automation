import { NavLink, Route, Routes } from "react-router-dom";
import { useApi } from "./hooks.js";
import Calls from "./pages/Calls.jsx";
import CallDetail from "./pages/CallDetail.jsx";
import Process from "./pages/Process.jsx";
import Settings from "./pages/Settings.jsx";
import Accuracy from "./pages/Accuracy.jsx";

export default function App() {
  const { data: health, error: down } = useApi("/health", { poll: 5000 });
  const { data: calls } = useApi("/calls?limit=1", { poll: 5000 });
  const { data: crms } = useApi("/crms", { poll: 15000 });
  const review = calls?.counts?.review ?? 0;
  const active = crms?.crms.find((c) => c.id === crms.active);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--petrol)" />
            <path d="M7 18h4l3-8 4 13 3-5h4" stroke="white" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Call Audit</span>
        </div>

        <nav aria-label="Main">
          <NavLink to="/" end>Calls</NavLink>
          <NavLink to="/review">
            Review
            {review > 0 && <span className="badge" aria-label={`${review} waiting`}>{review}</span>}
          </NavLink>
          <NavLink to="/process">Audit a lead</NavLink>
          <NavLink to="/accuracy">Accuracy</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>

        <div className="sidebar-foot">
          {down ? (
            <p className="conn conn-down">Server not reachable</p>
          ) : (
            <p className="conn">
              <span className={`conn-dot ${health?.busy ? "is-busy" : ""}`} aria-hidden="true" />
              {active ? active.label : "…"}
              {health?.busy && <span className="muted"> – working</span>}
            </p>
          )}
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Calls />} />
          <Route path="/review" element={<Calls reviewOnly />} />
          <Route path="/calls/:id" element={<CallDetail />} />
          <Route path="/process" element={<Process />} />
          <Route path="/accuracy" element={<Accuracy />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
