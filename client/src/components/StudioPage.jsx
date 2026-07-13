import { useCallback, useState } from 'react';
import UploadQueue from './UploadQueue.jsx';
import ConfigPanel from './ConfigPanel.jsx';
import JobStatusPanels from './JobStatusPanels.jsx';
import RecentVideos from './RecentVideos.jsx';
import useRenderJob from '../hooks/useRenderJob.js';

/**
 * The manual studio: full control over layout, audio mode, music query and
 * title. Upload order = edit order.
 */
export default function StudioPage() {
  const [files, setFiles] = useState([]);
  const [layout, setLayout] = useState('landscape');
  const [audioMode, setAudioMode] = useState('mute');
  const [musicQuery, setMusicQuery] = useState('');
  const [title, setTitle] = useState('');

  const job = useRenderJob();

  const handleGenerate = useCallback(() => {
    if (files.length === 0 || job.busy) return;
    const formData = new FormData();
    formData.append('mode', 'manual');
    formData.append('layout', layout);
    formData.append('audioMode', audioMode);
    formData.append('musicQuery', musicQuery);
    formData.append('title', title);
    // Append order IS the edit order — the server never re-sorts.
    files.forEach((item) => formData.append('files', item.file, item.file.name));
    job.submit(formData);
  }, [files, layout, audioMode, musicQuery, title, job]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <main className="space-y-6">
        <UploadQueue files={files} onChange={setFiles} disabled={job.busy} />
        <JobStatusPanels job={job} onRetry={job.reset} />
      </main>

      <aside>
        <ConfigPanel
          layout={layout}
          onLayoutChange={setLayout}
          audioMode={audioMode}
          onAudioModeChange={setAudioMode}
          musicQuery={musicQuery}
          onMusicQueryChange={setMusicQuery}
          title={title}
          onTitleChange={setTitle}
          disabled={job.busy}
        />
        <button
          type="button"
          onClick={handleGenerate}
          disabled={files.length === 0 || job.busy}
          className={`mt-4 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950 transition-all duration-300 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none ${
            files.length > 0 && !job.busy ? 'animate-glow-pulse' : ''
          }`}
        >
          {job.busy ? 'Working…' : `Generate video${files.length ? ` (${files.length} item${files.length > 1 ? 's' : ''})` : ''}`}
        </button>
        <RecentVideos refreshKey={job.resultUrl} />
      </aside>
    </div>
  );
}
