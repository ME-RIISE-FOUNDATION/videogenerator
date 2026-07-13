/**
 * Live render progress: animated bar + percentage + server-reported stage label.
 *
 * @param {{percent: number, stage: string}} props
 */
export default function ProgressBar({ percent, stage }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <section className="glass-card animate-fade-in-up">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium text-zinc-200">
          <span className="relative inline-flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-400" />
          </span>
          {stage || 'Working'}
        </span>
        <span className="font-mono tabular-nums text-indigo-300">{clamped}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800/80">
        <div
          className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-indigo-500 via-violet-400 to-fuchsia-400 transition-all duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        >
          <div className="absolute inset-y-0 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>
      </div>
    </section>
  );
}
