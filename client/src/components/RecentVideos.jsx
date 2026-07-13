import { useEffect } from 'react';
import useHistory from '../hooks/useHistory.js';

/**
 * Compact recent-videos panel for the generator sidebars: the last few
 * renders with open/download links, plus a link to the full History tab.
 *
 * @param {{refreshKey: *}} props Changing `refreshKey` (e.g. the finished
 *   render's URL) triggers a re-fetch so a just-completed video shows up.
 */
export default function RecentVideos({ refreshKey }) {
  const { videos, loading, refresh } = useHistory();

  useEffect(() => {
    if (refreshKey) refresh();
  }, [refreshKey, refresh]);

  const recent = videos.slice(0, 4);

  return (
    <section className="glass-card mt-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Recent videos</h2>
        <a href="#/history" className="text-xs text-indigo-400 underline-offset-2 hover:underline">
          View all →
        </a>
      </div>

      {loading ? (
        <p className="text-xs text-zinc-600">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="text-xs text-zinc-600">No videos yet — your renders will appear here.</p>
      ) : (
        <ul className="space-y-2">
          {recent.map((video) => (
            <li
              key={video.jobId}
              className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-zinc-950/80 px-2.5 py-2 transition-all duration-200 hover:translate-x-0.5 hover:border-indigo-500/40"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] text-zinc-300" title={video.fileName}>
                  🎞 {video.fileName}
                </p>
                <p className="text-[10px] text-zinc-600">{new Date(video.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <a
                  href={video.url}
                  target="_blank"
                  rel="noreferrer"
                  title="Play in new tab"
                  className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-200 transition hover:bg-indigo-600"
                >
                  ▶
                </a>
                <a
                  href={video.url}
                  download={video.fileName}
                  title="Download"
                  className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-zinc-200 transition hover:bg-emerald-600"
                >
                  ↓
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
