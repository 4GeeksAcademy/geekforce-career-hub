import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!path) return;
    try { setError(null); setData(await api.get<T>(path)); }
    catch (e) { setError(e); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { setLoading(true); reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}
