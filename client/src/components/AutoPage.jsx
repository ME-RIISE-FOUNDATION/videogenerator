import { useCallback, useState } from 'react';
import UploadQueue from './UploadQueue.jsx';
import JobStatusPanels from './JobStatusPanels.jsx';
import RecentVideos from './RecentVideos.jsx';
import useRenderJob from '../hooks/useRenderJob.js';

const VIBES = [
  {
    value: 'dynamic',
    label: 'Dynamic',
    emoji: '⚡',
    hint: 'Punchy 0.35s cuts (slides & zooms), vivid color, crisp detail, energetic music — 4s clips',
  },
  {
    value: 'cinematic',
    label: 'Cinematic',
    emoji: '🎬',
    hint: 'Teal-orange film grade, grain + letterbox bars, slow dissolves, orchestral score — 6s takes',
  },
  {
    value: 'chill',
    label: 'Chill',
    emoji: '🌊',
    hint: 'Warm golden tones, soft dissolves, relaxed pacing, calm acoustic music — 5s clips',
  },
];

/**
 * The Auto Generator: drop media, pick a vibe, one click. The server decides
 * layout (majority orientation), pacing (middle-trimmed clips), motion (Ken
 * Burns on photos), framing (blur-fill instead of black bars), curated
 * transitions, edge fades, color polish, and never-reused auto-fetched music.
 */
export default function AutoPage() {
  const [files, setFiles] = useState([]);
  const [vibe, setVibe] = useState('dynamic');

  const job = useRenderJob();

  const handleGenerate = useCallback(() => {
    if (files.length === 0 || job.busy) return;
    const formData = new FormData();
    formData.append('mode', 'auto');
    formData.append('vibe', vibe);
    // Append order IS the edit order — chronology reads as intentional editing.
    files.forEach((item) => formData.append('files', item.file, item.file.name));
    job.submit(formData);
  }, [files, vibe, job]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <main className="space-y-6">
        <UploadQueue files={files} onChange={setFiles} disabled={job.busy} />
        <JobStatusPanels job={job} onRetry={job.reset} />
      </main>

      <aside>
        <section className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Automatic mode</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Everything is decided for you: orientation from your media, motion on photos,
              blurred frame-fill, action-centered clip trims, professional fades, color
              polish, and a fresh music track no earlier video has used. Just pick a vibe.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2">
            {VIBES.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                  vibe === option.value
                    ? 'border-indigo-500 bg-indigo-950/40'
                    : 'border-zinc-700 bg-zinc-950 hover:border-zinc-600'
                } ${job.busy ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  name="vibe"
                  value={option.value}
                  checked={vibe === option.value}
                  disabled={job.busy}
                  onChange={() => setVibe(option.value)}
                  className="mt-0.5 accent-indigo-500"
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-100">
                    {option.emoji} {option.label}
                  </span>
                  <span className="block text-xs text-zinc-500">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={files.length === 0 || job.busy}
          className="mt-4 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950 transition hover:from-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
        >
          {job.busy ? 'Working…' : `✨ Auto-generate video${files.length ? ` (${files.length} item${files.length > 1 ? 's' : ''})` : ''}`}
        </button>
        <RecentVideos refreshKey={job.resultUrl} />
      </aside>
    </div>
  );
}
