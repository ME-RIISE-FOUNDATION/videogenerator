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
    `rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-300 ${
      active
        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-950'
        : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
    }`;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Living background: two slow-drifting aurora glows behind everything. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[36rem] w-[36rem] animate-aurora-a rounded-full bg-indigo-600/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[32rem] w-[32rem] animate-aurora-b rounded-full bg-fuchsia-600/15 blur-3xl" />
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10">
        <header className="mb-8 animate-fade-in-up">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="bg-gradient-to-r from-white via-indigo-200 to-violet-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
                Highlight Reel Studio
              </h1>
              <p className="mt-1 text-sm text-zinc-400">{SUBTITLES[route]}</p>
            </div>
            <nav className="flex gap-1 rounded-2xl border border-white/10 bg-zinc-900/50 p-1 shadow-lg shadow-black/20 backdrop-blur-xl">
              <a href="#/" className={tabClass(route === 'studio')}>
                Studio
              </a>
              <a href="#/auto" className={tabClass(route === 'auto')}>
                ✨ Auto
              </a>
              <a href="#/script" className={tabClass(route === 'script')}>
                📜 Script
              </a>
              <a href="#/history" className={tabClass(route === 'history')}>
                📼 History
              </a>
            </nav>
          </div>
        </header>

        {/* key={route} re-mounts the page so every tab switch animates in. */}
        <div key={route} className="animate-fade-in-up">
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
      </div>
    </div>
  );
}
