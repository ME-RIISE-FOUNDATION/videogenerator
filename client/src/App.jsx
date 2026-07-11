import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import UploadQueue from './components/UploadQueue.jsx';
import ConfigPanel from './components/ConfigPanel.jsx';
import ProgressBar from './components/ProgressBar.jsx';
import VideoPreview from './components/VideoPreview.jsx';

/**
 * Top-level app: owns the upload queue, render config, and the job lifecycle
 * state machine (idle → uploading → processing → done | error).
 */
export default function App() {
  const [files, setFiles] = useState([]); // [{ id, file, previewUrl, kind }]
  const [layout, setLayout] = useState('landscape');
  const [audioMode, setAudioMode] = useState('mute');
  const [musicQuery, setMusicQuery] = useState('');
  const [title, setTitle] = useState('');

  const [phase, setPhase] = useState('idle'); // idle | uploading | processing | done | error
  const [percent, setPercent] = useState(0);
  const [stage, setStage] = useState('');
  const [resultUrl, setResultUrl] = useState(null);
  const [attribution, setAttribution] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [warnings, setWarnings] = useState([]);

  const socketRef = useRef(null);

  const disconnectSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => () => disconnectSocket(), [disconnectSocket]);

  /** Subscribe to a job's Socket.io room and wire lifecycle events. */
  const subscribeToJob = useCallback(
    (jobId) => {
      disconnectSocket();
      const socket = io({ path: '/socket.io' });
      socketRef.current = socket;

      socket.on('connect', () => socket.emit('join', jobId));
      socket.on('progress', ({ percent: p, stage: s }) => {
        setPhase('processing');
        setPercent(p);
        setStage(s);
      });
      socket.on('warning', ({ message }) => {
        setWarnings((prev) => (prev.includes(message) ? prev : [...prev, message]));
      });
      socket.on('complete', ({ url, attribution: credit }) => {
        setPercent(100);
        setResultUrl(url);
        setAttribution(credit || null);
        setPhase('done');
        disconnectSocket();
      });
      socket.on('error', ({ message }) => {
        setErrorMessage(message || 'Rendering failed.');
        setPhase('error');
        disconnectSocket();
      });
    },
    [disconnectSocket]
  );

  /** POST the queue + config, then subscribe to the returned job. */
  const handleGenerate = useCallback(async () => {
    if (files.length === 0 || phase === 'uploading' || phase === 'processing') return;

    setPhase('uploading');
    setPercent(0);
    setStage('Uploading files');
    setWarnings([]);
    setErrorMessage('');
    setResultUrl(null);
    setAttribution(null);

    try {
      const formData = new FormData();
      formData.append('layout', layout);
      formData.append('audioMode', audioMode);
      formData.append('musicQuery', musicQuery);
      formData.append('title', title);
      // Append order IS the edit order — the server never re-sorts.
      files.forEach((item) => formData.append('files', item.file, item.file.name));

      const response = await fetch('/api/generate', { method: 'POST', body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Upload failed (HTTP ${response.status})`);
      }

      setPhase('processing');
      setStage('Starting render');
      subscribeToJob(data.jobId);
    } catch (err) {
      setErrorMessage(err.message);
      setPhase('error');
    }
  }, [files, layout, audioMode, musicQuery, title, phase, subscribeToJob]);

  const handleRetry = useCallback(() => {
    setPhase('idle');
    setPercent(0);
    setStage('');
    setErrorMessage('');
    setWarnings([]);
    setResultUrl(null);
    setAttribution(null);
  }, []);

  const busy = phase === 'uploading' || phase === 'processing';

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Highlight Reel <span className="text-indigo-400">Studio</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Upload photos and clips, pick a layout, and render a stitched highlight video — fully local.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <main className="space-y-6">
          <UploadQueue files={files} onChange={setFiles} disabled={busy} />

          {phase === 'done' && resultUrl ? (
            <VideoPreview url={resultUrl} attribution={attribution} onStartOver={handleRetry} />
          ) : null}

          {busy ? <ProgressBar percent={percent} stage={stage} /> : null}

          {phase === 'error' ? (
            <div className="rounded-xl border border-red-900 bg-red-950/50 p-4">
              <p className="text-sm font-semibold text-red-300">Render failed</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-red-400/80">{errorMessage}</p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
              >
                Try again
              </button>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="rounded-xl border border-amber-900 bg-amber-950/40 p-4">
              <p className="text-sm font-semibold text-amber-300">Warnings</p>
              <ul className="mt-1 list-inside list-disc space-y-1 text-xs text-amber-400/90">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
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
            disabled={busy}
          />
          <button
            type="button"
            onClick={handleGenerate}
            disabled={files.length === 0 || busy}
            className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
          >
            {busy ? 'Working…' : `Generate video${files.length ? ` (${files.length} item${files.length > 1 ? 's' : ''})` : ''}`}
          </button>
        </aside>
      </div>
    </div>
  );
}
