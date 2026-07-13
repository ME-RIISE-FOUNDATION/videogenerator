import { useCallback, useState } from 'react';
import UploadQueue from './UploadQueue.jsx';
import JobStatusPanels from './JobStatusPanels.jsx';
import RecentVideos from './RecentVideos.jsx';
import VibePicker from './VibePicker.jsx';
import useRenderJob from '../hooks/useRenderJob.js';

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
        <section className="glass-card space-y-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Automatic mode</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Everything is decided for you: orientation from your media, motion on photos,
              blurred frame-fill, action-centered clip trims, professional fades, color
              polish, and a fresh music track no earlier video has used. Just pick a vibe.
            </p>
          </div>

          <VibePicker vibe={vibe} onChange={setVibe} disabled={job.busy} />
        </section>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={files.length === 0 || job.busy}
          className={`mt-4 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950 transition-all duration-300 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none ${
            files.length > 0 && !job.busy ? 'animate-glow-pulse' : ''
          }`}
        >
          {job.busy ? 'Working…' : `✨ Auto-generate video${files.length ? ` (${files.length} item${files.length > 1 ? 's' : ''})` : ''}`}
        </button>
        <RecentVideos refreshKey={job.resultUrl} />
      </aside>
    </div>
  );
}
