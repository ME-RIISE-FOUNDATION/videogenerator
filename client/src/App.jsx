import { useEffect, useState } from 'react';
import StudioPage from './components/StudioPage.jsx';
import AutoPage from './components/AutoPage.jsx';
import ScriptPage from './components/ScriptPage.jsx';
import HistoryPage from './components/HistoryPage.jsx';

const SUBTITLES = {
  studio: 'Upload photos and clips, pick a layout, and render a stitched highlight video — fully local.',
  auto: 'Automatic mode — drop your media, pick a vibe, get a professional edit.',
  script: 'Write it, get it — scenes, visuals, captions, narration and music, generated from your script.',
  history: 'Every video you have generated, newest first — replay, download, or delete.',
};

/**
 * Top-level app: a tiny hash router (no dependency) switching between the
 * manual Studio (#/), the one-click Auto Generator (#/auto) and the History
 * of every generated video (#/history).
 */
export default function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const route = hash.startsWith('#/auto')
    ? 'auto'
    : hash.startsWith('#/script')
      ? 'script'
      : hash.startsWith('#/history')
        ? 'history'
        : 'studio';

  const tabClass = (active) =>
    `rounded-lg px-4 py-2 text-sm font-semibold transition ${
      active
        ? 'bg-indigo-600 text-white shadow shadow-indigo-950'
        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
    }`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Highlight Reel <span className="text-indigo-400">Studio</span>
            </h1>
            <p className="mt-1 text-sm text-zinc-400">{SUBTITLES[route]}</p>
          </div>
          <nav className="flex gap-1 rounded-xl border border-zinc-800 bg-zinc-900/60 p-1">
            <a href="#/" className={tabClass(route === 'studio')}>
              Studio
            </a>
            <a href="#/auto" className={tabClass(route === 'auto')}>
              ✨ Auto Generator
            </a>
            <a href="#/script" className={tabClass(route === 'script')}>
              📜 Script to Video
            </a>
            <a href="#/history" className={tabClass(route === 'history')}>
              📼 History
            </a>
          </nav>
        </div>
      </header>

      {route === 'auto' ? (
        <AutoPage />
      ) : route === 'script' ? (
        <ScriptPage />
      ) : route === 'history' ? (
        <HistoryPage />
      ) : (
        <StudioPage />
      )}
    </div>
  );
}
