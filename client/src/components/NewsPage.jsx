import { useCallback, useRef, useState } from 'react';
import JobStatusPanels from './JobStatusPanels.jsx';
import RecentVideos from './RecentVideos.jsx';
import useRenderJob from '../hooks/useRenderJob.js';

const NEWS_MODES = [
  {
    value: 'manual',
    label: '✍️ Write it myself',
    hint: 'Paste or type the script yourself - same as Script mode.',
  },
  {
    value: 'auto',
    label: '📡 Fetch top headlines',
    hint: 'Optional topic, or leave blank for todays top India headlines (Google News, no key needed).',
  },
];

const VOICE_MODES = [
  {
    value: 'voice',
    label: '🎤 My voice',
    hint: 'Upload your own narration recording - scenes are timed to fit it, music ducks underneath.',
  },
  {
    value: 'tts',
    label: '🗣️ Computer voice',
    hint: 'The script is read aloud automatically (Windows voice), scene by scene.',
  },
  {
    value: 'music',
    label: '🎵 Music only',
    hint: 'No narration - the soundtrack plays under the visuals.',
  },
];

const CAPTION_MODES = [
  {
    value: 'headline',
    label: '🔤 Headline + icon',
    hint: 'A big ideogram icon and a short 2-3 word title for each scene (default) - not the whole script.',
  },
  {
    value: 'full',
    label: '📄 Full text',
    hint: 'The old style: the entire scene paragraph as a lower-third subtitle.',
  },
  {
    value: 'none',
    label: '🚫 None',
    hint: 'Pure visuals, no on-screen text at all. Narration (if on) still speaks the full script.',
  },
];

/**
 * News → Video: manual script or auto-fetched headlines → scenes with the fixed
 * anchor image, TTS narration (default), and music.
 */
export default function NewsPage() {
  const [newsMode, setNewsMode] = useState('manual');
  const [script, setScript] = useState('');
  const [topic, setTopic] = useState('');
  const [layout, setLayout] = useState('landscape');
  const [voiceMode, setVoiceMode] = useState('tts');
  const [voiceFile, setVoiceFile] = useState(null);
  const [captionMode, setCaptionMode] = useState('headline');
  const [anchorImageFile, setAnchorImageFile] = useState(null);
  const voiceInputRef = useRef(null);
  const anchorImageInputRef = useRef(null);

  const job = useRenderJob();
  const canGenerate =
    (newsMode === 'manual' ? script.trim().length > 0 : true) &&
    !job.busy &&
    anchorImageFile !== null &&
    (voiceMode !== 'voice' || voiceFile !== null);

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return;
    const formData = new FormData();
    formData.append('mode', 'news');
    formData.append('newsMode', newsMode);
    if (newsMode === 'manual') {
      formData.append('script', script);
    } else {
      formData.append('newsTopic', topic);
    }
    formData.append('voiceMode', voiceMode);
    formData.append('layout', layout);
    formData.append('captionMode', captionMode);
    if (anchorImageFile) {
      formData.append('anchorImage', anchorImageFile, anchorImageFile.name);
    }
    if (voiceMode === 'voice' && voiceFile) {
      formData.append('voice', voiceFile, voiceFile.name);
    }
    job.submit(formData);
  }, [canGenerate, newsMode, script, topic, voiceMode, voiceFile, layout, captionMode, anchorImageFile, job]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <main className="space-y-6">
        <section className="glass-card">
          <div className="mb-4">
            <label htmlFor="anchor-image" className="mb-2 block text-xs font-medium text-zinc-300">
              Anchor Image (required)
            </label>
            <input
              ref={anchorImageInputRef}
              id="anchor-image"
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              disabled={job.busy}
              onChange={(e) => setAnchorImageFile(e.target.files[0] || null)}
              className="block w-full text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-indigo-500"
            />
            {anchorImageFile ? (
              <>
                <p className="mt-2 truncate text-[11px] text-emerald-400">✓ {anchorImageFile.name}</p>
                <img
                  src={URL.createObjectURL(anchorImageFile)}
                  alt="Anchor preview"
                  className="mt-2 h-24 rounded-lg border border-zinc-700 object-cover shadow-lg"
                />
              </>
            ) : (
              <p className="mt-2 text-[11px] text-amber-400">Upload a news anchor or presenter photo (.jpg .png .webp)</p>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-zinc-300">Mode</span>
            <div className="grid grid-cols-1 gap-2">
              {NEWS_MODES.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-200 ${
                    newsMode === option.value
                      ? 'border-indigo-400/60 bg-indigo-950/40 shadow-lg shadow-indigo-950/40 ring-1 ring-indigo-400/30'
                      : 'border-zinc-700 bg-zinc-950/80 hover:-translate-y-0.5 hover:border-zinc-500'
                  } ${job.busy ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="newsMode"
                    value={option.value}
                    checked={newsMode === option.value}
                    disabled={job.busy}
                    onChange={() => setNewsMode(option.value)}
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
        </section>

        <section className="glass-card">
          {newsMode === 'manual' ? (
            <>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Your script</h2>
                <span className="text-xs text-zinc-500">
                  {script.trim() ? `${script.trim().split(/\s+/).length} words` : ''}
                </span>
              </div>
              <textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                disabled={job.busy}
                rows={12}
                maxLength={8000}
                placeholder="Breaking News Update

The market surged today with strong gains across all sectors.

The technology index led the charge with a 2.5% jump."
                className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-sm leading-relaxed text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-indigo-500 disabled:opacity-50"
              />
              <p className="mt-2 text-[11px] leading-snug text-zinc-600">
                Each blank-line-separated paragraph becomes a scene with the anchor image. A short first
                line becomes the title slide. Up to 20 scenes. On-screen text is a short headline + icon
                by default (see Captions in the sidebar) - narration, if enabled, always speaks the full
                scene text regardless of what's shown.
              </p>
            </>
          ) : (
            <>
              <label htmlFor="news-topic" className="mb-3 block text-sm font-semibold uppercase tracking-wider text-zinc-400">
                Topic (optional)
              </label>
              <input
                id="news-topic"
                type="text"
                value={topic}
                maxLength={150}
                disabled={job.busy}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Leave blank for todays top India headlines (e.g. cricket, market, technology)"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-indigo-500 disabled:opacity-50"
              />
              <p className="mt-2 text-[11px] leading-snug text-zinc-600">
                The system will fetch todays top headlines (or headlines matching your topic) from Google
                News and turn them into scenes automatically. Captions and narration work the same as manual
                mode.
              </p>
            </>
          )}
        </section>

        <JobStatusPanels job={job} onRetry={job.reset} />
      </main>

      <aside>
        <section className="glass-card space-y-5">
          <div>
            <label htmlFor="news-layout" className="mb-1.5 block text-xs font-medium text-zinc-300">
              Layout
            </label>
            <select
              id="news-layout"
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
            <span className="mb-1.5 block text-xs font-medium text-zinc-300">Captions</span>
            <div className="grid grid-cols-1 gap-2">
              {CAPTION_MODES.map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-200 ${
                    captionMode === option.value
                      ? 'border-indigo-400/60 bg-indigo-950/40 shadow-lg shadow-indigo-950/40 ring-1 ring-indigo-400/30'
                      : 'border-zinc-700 bg-zinc-950/80 hover:-translate-y-0.5 hover:border-zinc-500'
                  } ${job.busy ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="captionMode"
                    value={option.value}
                    checked={captionMode === option.value}
                    disabled={job.busy}
                    onChange={() => setCaptionMode(option.value)}
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
          {job.busy ? 'Working…' : newsMode === 'auto' ? '📰 Fetch headlines & generate' : '📰 Generate news video'}
        </button>
        <RecentVideos refreshKey={job.resultUrl} />
      </aside>
    </div>
  );
}
