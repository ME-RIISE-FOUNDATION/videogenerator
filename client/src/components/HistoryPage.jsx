import useHistory from '../hooks/useHistory.js';

/**
 * Full history: every generated video ever, newest first — replay, download,
 * music credit, delete.
 */
export default function HistoryPage() {
  const { videos, loading, error, refresh, remove } = useHistory();

  const handleDelete = async (video) => {
    if (!window.confirm(`Delete ${video.fileName}? This cannot be undone.`)) return;
    try {
      await remove(video.jobId);
    } catch (err) {
      window.alert(err.message);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-zinc-400">
          {loading ? 'Loading…' : `${videos.length} video${videos.length === 1 ? '' : 's'} generated`}
        </p>
        <button
          type="button"
          onClick={refresh}
          className="rounded-lg border border-white/10 bg-zinc-900/60 px-3 py-1.5 text-xs font-semibold text-zinc-300 backdrop-blur transition-all duration-200 hover:border-indigo-400/50 hover:text-white active:scale-95"
        >
          ↻ Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-900 bg-red-950/50 p-4 text-sm text-red-300">{error}</div>
      ) : null}

      {!loading && !error && videos.length === 0 ? (
        <div className="animate-fade-in-up rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/30 p-10 text-center text-sm text-zinc-500 backdrop-blur">
          Nothing here yet — generate your first video in the{' '}
          <a href="#/" className="text-indigo-400 underline underline-offset-2">Studio</a> or the{' '}
          <a href="#/auto" className="text-indigo-400 underline underline-offset-2">Auto Generator</a>.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {videos.map((video, index) => (
          <article
            key={video.jobId}
            style={{ animationDelay: `${Math.min(index, 10) * 60}ms` }}
            className="animate-fade-in-up overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/50 shadow-lg shadow-black/20 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-indigo-500/30 hover:shadow-xl hover:shadow-indigo-950/30"
          >
            <video controls preload="metadata" src={video.url} className="aspect-video w-full bg-black" />
            <div className="space-y-2 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-mono text-xs text-zinc-400" title={video.fileName}>
                  {video.fileName}
                </p>
                <p className="shrink-0 text-xs text-zinc-500">{(video.sizeBytes / (1024 * 1024)).toFixed(1)} MB</p>
              </div>
              <p className="text-xs text-zinc-500">{new Date(video.createdAt).toLocaleString()}</p>
              {video.attribution ? (
                <p className="text-[11px] leading-snug text-zinc-500">
                  ♪ “{video.attribution.title}” by {video.attribution.creator} ({video.attribution.license}) —{' '}
                  <a
                    href={video.attribution.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:text-zinc-300"
                  >
                    source
                  </a>
                </p>
              ) : (
                <p className="text-[11px] text-zinc-600">♪ no fetched music recorded</p>
              )}
              {video.imageCredits && video.imageCredits.length > 0 ? (
                <details className="text-[11px] text-zinc-500">
                  <summary className="cursor-pointer select-none hover:text-zinc-300">
                    🖼 {video.imageCredits.length} CC image{video.imageCredits.length > 1 ? 's' : ''} — credits
                  </summary>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {video.imageCredits.map((credit, i) => (
                      <li key={`${credit.sourceUrl}-${i}`}>
                        “{credit.title}” by {credit.creator} ({credit.license}) —{' '}
                        <a href={credit.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-zinc-300">
                          source
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="flex gap-2 pt-1">
                <a
                  href={video.url}
                  download={video.fileName}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => handleDelete(video)}
                  className="rounded-lg border border-red-900 px-3 py-1.5 text-xs font-semibold text-red-400 transition hover:bg-red-950"
                >
                  Delete
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
