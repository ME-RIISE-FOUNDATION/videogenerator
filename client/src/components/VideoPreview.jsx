/**
 * Final result: inline HTML5 player for the rendered mp4 plus a download
 * button, shown once the server emits `complete`. When the background music
 * was fetched online (CC-licensed), its attribution is displayed — CC BY
 * requires credit if you publish the video.
 *
 * @param {{url: string, attribution: {title: string, creator: string,
 *   license: string, sourceUrl: string}|null, onStartOver: function}} props
 */
export default function VideoPreview({ url, attribution, onStartOver }) {
  const fileName = url.split('/').pop();
  return (
    <section className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-emerald-300">✓ Your highlight reel is ready</h2>
        <button
          type="button"
          onClick={onStartOver}
          className="text-xs text-zinc-400 underline-offset-2 transition hover:text-zinc-200 hover:underline"
        >
          Start over
        </button>
      </div>
      <video controls src={url} className="max-h-[60vh] w-full rounded-lg bg-black" />
      {attribution ? (
        <p className="mt-2 text-[11px] leading-snug text-zinc-500">
          Music: “{attribution.title}” by {attribution.creator} ({attribution.license}) —{' '}
          <a
            href={attribution.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-zinc-300"
          >
            source
          </a>
          . Credit the artist if you publish this video.
        </p>
      ) : null}
      <a
        href={url}
        download={fileName}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
          />
        </svg>
        Download {fileName}
      </a>
    </section>
  );
}
