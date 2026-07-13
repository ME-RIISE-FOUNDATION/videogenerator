import { useCallback, useEffect, useState } from 'react';

/**
 * Shared access to the generated-video history (GET /api/history), with
 * delete support. Fetches on mount; call refresh() to re-sync (e.g. after a
 * render completes).
 *
 * @returns {{videos: Array<object>, loading: boolean, error: string,
 *   refresh: function(): Promise<void>, remove: function(string): Promise<void>}}
 */
export default function useHistory() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/history');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setVideos(data.videos || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = useCallback(async (jobId) => {
    const response = await fetch(`/api/history/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    if (response.ok) {
      setVideos((prev) => prev.filter((v) => v.jobId !== jobId));
    } else {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Delete failed (HTTP ${response.status})`);
    }
  }, []);

  return { videos, loading, error, refresh, remove };
}
