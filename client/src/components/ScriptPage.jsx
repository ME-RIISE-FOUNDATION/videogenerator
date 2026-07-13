import { useCallback, useRef, useState } from 'react';
import VibePicker from './VibePicker.jsx';
import JobStatusPanels from './JobStatusPanels.jsx';
import RecentVideos from './RecentVideos.jsx';
import useRenderJob from '../hooks/useRenderJob.js';

const VOICE_MODES = [
  {
    value: 'voice',
    label: '🎤 My voice',
    hint: 'Upload your own narration recording — scenes are timed to fit it, music ducks underneath.',
  },
  {
    value: 'tts',
    label: '🗣️ Computer voice',
    hint: 'The script is read aloud automatically (Windows voice), scene by scene.',
  },
  {
    value: 'music',
    label: '🎵 Music only',
    hint: 'No narration — captions carry the script over the soundtrack.',
  },
];

/**
 * Script → Video: paste a script, the app finds visuals for every scene,
 * animates them, captions them, narrates them (3 narration modes), scores
 * them with never-reused music, and renders with the vibe's full look.
 */
export default function ScriptPage() {
  const [script, setScript] = useState('');
  const [vibe, setVibe] = useState('cinematic');
  const [layout, setLayout] = useState('landscape');
  const [voiceMode, setVoiceMode] = useState('tts');
  const [voiceFile, setVoiceFile] = useState(null);
  const voiceInputRef = useRef(null);

  const job = useRenderJob();
  const canGenerate =
    script.trim().length > 0 && !job.busy && (voiceMode !== 'voice' || voiceFile !== null);

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return;
    const formData = new FormData();
    formData.append('mode', 'script');
    formData.append('script', script);
    formData.append('vibe', vibe);
    formData.append('layout', layout);
    formData.append('voiceMode', voiceMode);
    if (voiceMode === 'voice' && voiceFile) {
      formData.append('voice', voiceFile, voiceFile.name);
    }
    job.submit(formData);
  }, [canGenerate, script, vibe, layout, voiceMode, voiceFile, job]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <main className="space-y-6">
        <section className="glass-card">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Your script</h2>
            <span className="text-xs text-zinc-500">{script.trim() ? `${script.trim().split(/\s+/).length} words` : ''}</span>
          </div>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            disabled={job.busy}
            rows={12}
            maxLength={8000}
            placeholder={
              'My Trip to the Mountains\n\n' +
              'Last summer we hiked through the pine forests, following the river to the base camp.\n\n' +
              'At sunrise the peaks turned gold, and we finally reached the summit together.'
            }
            className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-sm leading-relaxed text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-indigo-500 disabled:opacity-50"
          />
          <p className="mt-2 text-[11px] leading-snug text-zinc-600">
            Each blank-line-separated paragraph becomes a scene with its own auto-fetched visual and caption.
            A short first line becomes the title slide. Up to 20 scenes.
          </p>
        </section>

        <JobStatusPanels job={job} onRetry={job.reset} />
      </main>

      <aside>
        <section className="glass-card space-y-5">
          <div>
            <span className="mb-1.5 block text-xs font-medium text-zinc-300">Vibe</span>
            <VibePicker vibe={vibe} onChange={setVibe} disabled={job.busy} />
          </div>

          <div>
            <label htmlFor="script-layout" className="mb-1.5 block text-xs font-medium text-zinc-300">
              Layout
            </label>
            <select
              id="script-layout"
              value={layout}
              disabled={job.busy}
              onChange={(e) => setLayout(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-indigo-500 disabled:opacity-50"
            >
              <option value="landscape">Landscape (16:9 — 1920x1080)</option>
              <option value="portrait">Portrait (9:16 — 1080x1920)</option>
            </select>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-zinc-300">Narration</span>
            <div className="grid grid-cols-1 gap-2">
              {VOICE_MODES.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-200 ${
                    voiceMode === option.value
                      ? 'border-indigo-400/60 bg-indigo-950/40 shadow-lg shadow-indigo-950/40 ring-1 ring-indigo-400/30'
                      : 'border-zinc-700 bg-zinc-950/80 hover:-translate-y-0.5 hover:border-zinc-500'
                  } ${job.busy ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="voiceMode"
                    value={option.value}
                    checked={voiceMode === option.value}
                    disabled={job.busy}
                    onChange={() => setVoiceMode(option.value)}
                    className="mt-0.5 accent-indigo-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-zinc-100">{option.label}</span>
                    <span className="block text-xs text-zinc-500">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {voiceMode === 'voice' ? (
              <div className="mt-2">
                <input
                  ref={voiceInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.aac,.ogg"
                  disabled={job.busy}
                  onChange={(e) => setVoiceFile(e.target.files[0] || null)}
                  className="block w-full text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-indigo-500"
                />
                {voiceFile ? (
                  <p className="mt-1 truncate text-[11px] text-emerald-400">✓ {voiceFile.name}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-amber-400">Choose your narration audio file (.mp3 .wav .m4a .aac .ogg)</p>
                )}
              </div>
            ) : null}
          </div>
        </section>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          className={`mt-4 w-full rounded-xl bg-gradient-to-r from-fuchsia-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950 transition-all duration-300 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500 disabled:shadow-none ${
            canGenerate ? 'animate-glow-pulse' : ''
          }`}
        >
          {job.busy ? 'Working…' : '📜 Generate video from script'}
        </button>
        <RecentVideos refreshKey={job.resultUrl} />
      </aside>
    </div>
  );
}
