import ProgressBar from './ProgressBar.jsx';
import VideoPreview from './VideoPreview.jsx';

/**
 * The shared result/progress/error/warnings block rendered under both pages,
 * driven entirely by a useRenderJob() instance.
 *
 * @param {{job: object, onRetry: function}} props `job` is the object returned
 *   by useRenderJob(); `onRetry` resets back to the editable state.
 */
export default function JobStatusPanels({ job, onRetry }) {
  return (
    <>
      {job.phase === 'done' && job.resultUrl ? (
        <VideoPreview
          url={job.resultUrl}
          attribution={job.attribution}
          imageCredits={job.imageCredits}
          onStartOver={onRetry}
        />
      ) : null}

      {job.busy ? <ProgressBar percent={job.percent} stage={job.stage} /> : null}

      {job.phase === 'error' ? (
        <div className="animate-fade-in-up rounded-2xl border border-red-500/30 bg-red-950/40 p-4 shadow-lg shadow-black/20 backdrop-blur-xl">
          <p className="text-sm font-semibold text-red-300">Render failed</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-red-400/80">{job.errorMessage}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
          >
            Try again
          </button>
        </div>
      ) : null}

      {job.warnings.length > 0 ? (
        <div className="animate-fade-in-up rounded-2xl border border-amber-500/25 bg-amber-950/30 p-4 shadow-lg shadow-black/20 backdrop-blur-xl">
          <p className="text-sm font-semibold text-amber-300">Warnings</p>
          <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-amber-400/90">
            {job.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
