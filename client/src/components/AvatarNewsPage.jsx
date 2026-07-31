import { useCallback, useRef, useState } from 'react';
import JobStatusPanels from './JobStatusPanels.jsx';
import RecentVideos from './RecentVideos.jsx';
import useRenderJob from '../hooks/useRenderJob.js';

const AVATARS = [
  { id: 'avatar1', label: 'Avatar 1' },
  { id: 'avatar2', label: 'Avatar 2' },
  { id: 'avatar3', label: 'Avatar 3' },
  { id: 'avatar4', label: 'Avatar 4' },
  { id: 'avatar5', label: 'Avatar 5' },
];

const DURATION_OPTIONS = [
  { value: '15', label: '15s' },
  { value: '30', label: '30s' },
  { value: '45', label: '45s' },
  { value: '60', label: '60s' },
];

const NEWS_MODES = [
  {
    value: 'manual',
    label: 'Write it myself',
    hint: 'Paste or type the script yourself.',
  },
  {
    value: 'auto',
    label: 'Fetch top headlines',
    hint: 'Optional topic, or leave blank for todays top India headlines.',
  },
];

const VOICE_MODES = [
  {
    value: 'voice',
    label: 'My voice',
    hint: 'Upload your own narration recording - scenes are timed to fit it.',
  },
  {
    value: 'tts',
    label: 'Computer voice',
    hint: 'The script is read aloud automatically (Windows voice).',
  },
  {
    value: 'music',
    label: 'Music only',
    hint: 'No narration - the soundtrack plays under the avatar.',
  },
];

const CAPTION_MODES = [
  {
    value: 'headline',
    label: 'Headline + icon',
    hint: 'A big ideogram icon and a short 2-3 word title for each scene.',
  },
  {
    value: 'full',
    label: 'Full text',
    hint: 'The entire scene paragraph as a lower-third subtitle.',
  },
  {
    value: 'none',
    label: 'None',
    hint: 'Pure visuals, no on-screen text at all.',
  },
];

export default function AvatarNewsPage() {
  const [avatarId, setAvatarId] = useState('avatar1');
  const [durationMode, setDurationMode] = useState('45');
  const [customDuration, setCustomDuration] = useState('');
  const [newsMode, setNewsMode] = useState('manual');
  const [script, setScript] = useState('');
  const [topic, setTopic] = useState('');
  const [layout, setLayout] = useState('landscape');
  const [voiceMode, setVoiceMode] = useState('tts');
  const [voiceFile, setVoiceFile] = useState(null);
  const [captionMode, setCaptionMode] = useState('headline');
  const voiceInputRef = useRef(null);

  const job = useRenderJob();
  const canGenerate =
    (newsMode === 'manual' ? script.trim().length > 0 : true) &&
    !job.busy &&
    (voiceMode !== 'voice' || voiceFile !== null);

  const targetDuration = durationMode === 'custom' ? customDuration : durationMode;

  const handleGenerate = useCallback(() => {
    if (!canGenerate) return;
    const formData = new FormData();
    formData.append('mode', 'avatar');
    formData.append('avatarId', avatarId);
    formData.append('targetDuration', targetDuration);
    formData.append('newsMode', newsMode);
    if (newsMode === 'manual') {
      formData.append('script', script);
    } else {
      formData.append('newsTopic', topic);
    }
    formData.append('voiceMode', voiceMode);
    formData.append('layout', layout);
    formData.append('captionMode', captionMode);
    if (voiceMode === 'voice' && voiceFile) {
      formData.append('voice', voiceFile, voiceFile.name);
    }
    job.submit(formData);
  }, [canGenerate, avatarId, targetDuration, newsMode, script, topic, voiceMode, voiceFile, layout, captionMode, job]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <main className="space-y-6">
        <section className="glass-card">
          <div className="mb-5">
            <label className="mb-3 block text-xs font-medium text-zinc-300">Select Avatar</label>
            <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
              {AVATARS.map((avatar) => (
                <label
                  key={avatar.id}
                  className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-all duration-200 ${
                    avatarId === avatar.id
                      ? 'border-indigo-400 bg-indigo-950/40 shadow-lg shadow-indigo-950/40'
                      : 'border-zinc-700 bg-zinc-950/80 hover:-translate-y-0.5 hover:border-zinc-500'
                  } ${job.busy ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="avatar"
                    value={avatar.id}
                    checked={avatarId === avatar.id}
                    disabled={job.busy}
                    onChange={() => setAvatarId(avatar.id)}
                    className="accent-indigo-500"
                  />
                  <img
                    src={`/avatars/${avatar.id}.jpg`}
                    alt={avatar.label}
                    className="h-16 w-14 rounded object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                  <span className="text-[10px] font-medium text-zinc-400">{avatar.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">Note: Add avatar images to client/public/avatars/ folder</p>
          </div>

          <div className="mb-5">
            <label className="mb-3 block text-xs font-medium text-zinc-300">Video Duration</label>
            <div className="mb-3 grid grid-cols-4 gap-2">
              {DURATION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setDurationMode(option.value);
                    setCustomDuration('');
                  }}
                  disabled={job.busy}
                  className={`rounded-lg border px-2 py-2 text-sm font-medium transition-all ${
                    durationMode === option.value && !customDuration
                      ? 'border-indigo-400 bg-indigo-600 text-white shadow-lg shadow-indigo-950/40'
                      : 'border-zinc-700 bg-zinc-950/80 text-zinc-300 hover:border-zinc-500'
                  } ${job.busy ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div>
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <span>Custom:</span>
                <input
                  type="number"
                  min="15"
                  max="300"
                  value={customDuration}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                      setDurationMode('custom');
                      setCustomDuration(val);
                    } else {
                      setCustomDuration('');
                      setDurationMode('45');
                    }
                  }}
                  disabled={job.busy}
                  placeholder="15-300s"
                  className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 disabled:opacity-50"
                />
                <span className="text-zinc-600">seconds</span>
              </label>
              <p className="mt-1 text-[11px] text-zinc-600">Target duration - scenes will be paced to fit</p>
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-zinc-300">News Source</span>
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
                Each blank-line-separated paragraph becomes a scene with the avatar. A short first
                line becomes the title slide. Up to 20 scenes.
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
                News and turn them into scenes automatically.
              </p>
            </>
          )}
        </section>

        <JobStatusPanels job={job} onRetry={job.reset} />
      </main>

      <aside>
        <section className="glass-card space-y-5">
          <div>
            <label htmlFor="avatar-layout" className="mb-1.5 block text-xs font-medium text-zinc-300">
              Layout
            </label>
            <select
              id="avatar-layout"
              value={layout}
              disabled={job.busy}
              onChange={(e) => setLayout(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-indigo-500 disabled:opacity-50"
            >
              <option value="landscape">Landscape (16:9)</option>
              <option value="portrait">Portrait (9:16)</option>
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
                  <p className="mt-1 text-[11px] text-amber-400">Choose your narration audio file</p>
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
          {job.busy ? 'Working...' : newsMode === 'auto' ? 'Fetch headlines & generate' : 'Generate avatar video'}
        </button>
        <RecentVideos refreshKey={job.resultUrl} />
      </aside>
    </div>
  );
}
