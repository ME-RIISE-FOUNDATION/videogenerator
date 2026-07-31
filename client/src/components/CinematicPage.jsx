import { useCallback, useRef, useState } from 'react';
import UploadQueue from './UploadQueue.jsx';
import JobStatusPanels from './JobStatusPanels.jsx';
import RecentVideos from './RecentVideos.jsx';
import useRenderJob from '../hooks/useRenderJob.js';

const PACING_OPTIONS = [
  {
    value: 'frenzy',
    label: 'Frenzy',
    duration: '0.5s cuts',
    hint: 'Hyper-fast, chaotic energy - every 0.5 seconds',
  },
  {
    value: 'fast',
    label: 'Fast',
    duration: '0.8s cuts',
    hint: 'Dynamic & energetic - every 0.8 seconds',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    duration: '1.2s cuts',
    hint: 'Professional & dramatic - every 1.2 seconds',
  },
];

const COLOR_GRADES = [
  {
    value: 'subtle',
    label: 'Subtle',
    hint: 'Slight warm highlights, minimal teal',
  },
  {
    value: 'cinematic',
    label: 'Cinematic',
    hint: 'Golden shadows, teal highlights, film grain',
  },
  {
    value: 'ultra',
    label: 'Ultra',
    hint: 'Maximum contrast, bold warm/teal, bloom effects',
  },
];

export default function CinematicPage() {
  const [files, setFiles] = useState([]);
  const [pacing, setPacing] = useState('fast');
  const [colorGrade, setColorGrade] = useState('cinematic');
  const [durationTarget, setDurationTarget] = useState('25');
  const [musicFile, setMusicFile] = useState(null);
  const [musicQuery, setMusicQuery] = useState('cinematic travel');
  const [useCustomMusic, setUseCustomMusic] = useState(false);
  const musicInputRef = useRef(null);

  const job = useRenderJob();

  const estimatedCuts = Math.floor(parseInt(durationTarget) / (pacing === 'frenzy' ? 0.5 : pacing === 'fast' ? 0.8 : 1.2));

  const canGenerate = files.length >= 2 && !job.busy && (useCustomMusic ? musicFile !== null : true);

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return;
    const formData = new FormData();
    formData.append('mode', 'cinematic');
    formData.append('pacing', pacing);
    formData.append('colorGrade', colorGrade);
    formData.append('durationTarget', durationTarget);
    if (useCustomMusic && musicFile) {
      formData.append('music', musicFile, musicFile.name);
    } else {
      formData.append('musicQuery', musicQuery);
    }
    files.forEach((item) => formData.append('clips', item.file, item.file.name));
    job.submit(formData);
  }, [files, pacing, colorGrade, durationTarget, musicFile, musicQuery, useCustomMusic, canGenerate, job]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <main className="space-y-6">
        <UploadQueue
          files={files}
          onChange={setFiles}
          disabled={job.busy}
          title="Video Clips"
          orderHint="Order below = edit order (requires 2+ clips)"
        />
        <JobStatusPanels job={job} onRetry={job.reset} />
      </main>

      <aside>
        <section className="glass-card space-y-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Cinematic Settings</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              Ultra-premium 9:16 travel reel. Fast cuts synced to music, cinematic color grading,
              smooth transitions. 20-30 seconds.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-300">Pacing</label>
            <div className="space-y-2">
              {PACING_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                    pacing === option.value
                      ? 'border-indigo-500 bg-indigo-950/40'
                      : 'border-zinc-700 bg-zinc-950 hover:border-zinc-600'
                  } ${job.busy ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="pacing"
                    value={option.value}
                    checked={pacing === option.value}
                    disabled={job.busy}
                    onChange={() => setPacing(option.value)}
                    className="mt-0.5 accent-indigo-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-zinc-100">{option.label}</span>
                    <span className="block text-xs text-zinc-500">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-zinc-300">Color Grade</label>
            <div className="space-y-2">
              {COLOR_GRADES.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                    colorGrade === option.value
                      ? 'border-indigo-500 bg-indigo-950/40'
                      : 'border-zinc-700 bg-zinc-950 hover:border-zinc-600'
                  } ${job.busy ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="colorGrade"
                    value={option.value}
                    checked={colorGrade === option.value}
                    disabled={job.busy}
                    onChange={() => setColorGrade(option.value)}
                    className="mt-0.5 accent-indigo-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-zinc-100">{option.label}</span>
                    <span className="block text-xs text-zinc-500">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="duration-target" className="mb-2 block text-xs font-medium text-zinc-300">
              Duration Target
            </label>
            <div className="flex items-center gap-2">
              <input
                id="duration-target"
                type="range"
                min="15"
                max="60"
                value={durationTarget}
                disabled={job.busy}
                onChange={(e) => setDurationTarget(e.target.value)}
                className="flex-1"
              />
              <span className="w-12 text-right text-sm font-medium text-zinc-300">{durationTarget}s</span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-600">~{estimatedCuts} cuts at {pacing} pace</p>
          </div>

          <div>
            <span className="mb-2 block text-xs font-medium text-zinc-300">Music</span>
            <div className="space-y-2">
              <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                !useCustomMusic
                  ? 'border-indigo-500 bg-indigo-950/40'
                  : 'border-zinc-700 bg-zinc-950 hover:border-zinc-600'
              } ${job.busy ? 'cursor-not-allowed opacity-50' : ''}`}>
                <input
                  type="radio"
                  name="musicMode"
                  checked={!useCustomMusic}
                  disabled={job.busy}
                  onChange={() => setUseCustomMusic(false)}
                  className="mt-0.5 accent-indigo-500"
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-100">Fetch cinematic track</span>
                  <span className="block text-xs text-zinc-500">Auto-search online (CC-licensed)</span>
                </span>
              </label>
              <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                useCustomMusic
                  ? 'border-indigo-500 bg-indigo-950/40'
                  : 'border-zinc-700 bg-zinc-950 hover:border-zinc-600'
              } ${job.busy ? 'cursor-not-allowed opacity-50' : ''}`}>
                <input
                  type="radio"
                  name="musicMode"
                  checked={useCustomMusic}
                  disabled={job.busy}
                  onChange={() => setUseCustomMusic(true)}
                  className="mt-0.5 accent-indigo-500"
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-100">Upload your music</span>
                  <span className="block text-xs text-zinc-500">Use your own track</span>
                </span>
              </label>
            </div>
            {!useCustomMusic ? (
              <input
                type="text"
                value={musicQuery}
                maxLength={100}
                disabled={job.busy}
                onChange={(e) => setMusicQuery(e.target.value)}
                placeholder="e.g. epic cinematic, ambient travel"
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-indigo-500 disabled:opacity-50"
              />
            ) : (
              <div className="mt-2">
                <input
                  ref={musicInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.aac,.ogg"
                  disabled={job.busy}
                  onChange={(e) => setMusicFile(e.target.files[0] || null)}
                  className="block w-full text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-indigo-500"
                />
                {musicFile ? (
                  <p className="mt-1 truncate text-[11px] text-emerald-400">✓ {musicFile.name}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-amber-400">Choose an audio file (.mp3 .wav .m4a .aac .ogg)</p>
                )}
              </div>
            )}
          </div>
        </section>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={`w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950 transition-all duration-300 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none ${
            canGenerate ? 'animate-glow-pulse' : ''
          }`}
        >
          {job.busy ? 'Creating reel...' : files.length < 2 ? 'Upload 2+ clips' : 'Generate Cinematic Reel'}
        </button>
        <RecentVideos refreshKey={job.resultUrl} />
      </aside>
    </div>
  );
}
