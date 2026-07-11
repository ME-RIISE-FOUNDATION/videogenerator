/**
 * Live render progress: animated bar + percentage + server-reported stage label.
 *
 * @param {{percent: number, stage: string}} props
 */
export default function ProgressBar({ percent, stage }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium text-zinc-200">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
          {stage || 'Working'}
        </span>
        <span className="font-mono text-indigo-300">{clamped}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400 transition-all duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </section>
  );
}
