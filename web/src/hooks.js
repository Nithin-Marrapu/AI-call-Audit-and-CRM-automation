import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";

// Loads a GET endpoint. `poll` (ms) refreshes it in the background.
export function useApi(path, { poll } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api.get(path);
      if (alive.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    load();
    if (!poll) return () => (alive.current = false);
    const t = setInterval(load, poll);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load, poll]);

  return { data, error, loading, reload: load, setData };
}
