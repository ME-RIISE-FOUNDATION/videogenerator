/**
 * Render configuration: output layout, audio mode, background-music search,
 * optional title slide text.
 *
 * @param {{layout: string, onLayoutChange: function, audioMode: string,
 *   onAudioModeChange: function, musicQuery: string, onMusicQueryChange: function,
 *   title: string, onTitleChange: function, disabled: boolean}} props
 */
export default function ConfigPanel({
  layout,
  onLayoutChange,
  audioMode,
  onAudioModeChange,
  musicQuery,
  onMusicQueryChange,
  title,
  onTitleChange,
  disabled,
}) {
  return (
    <section className="glass-card space-y-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Settings</h2>

      <div>
        <label htmlFor="layout" className="mb-1.5 block text-xs font-medium text-zinc-300">
          Layout
        </label>
        <select
          id="layout"
          value={layout}
          disabled={disabled}
          onChange={(e) => onLayoutChange(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-indigo-500 disabled:opacity-50"
        >
          <option value="portrait">Portrait (9:16 — 1080x1920)</option>
          <option value="landscape">Landscape (16:9 — 1920x1080)</option>
        </select>
      </div>

      <div>
        <span className="mb-1.5 block text-xs font-medium text-zinc-300">Audio mode</span>
        <div className="grid grid-cols-1 gap-2">
          {[
            { value: 'mute', label: 'Mute Original Clips', hint: 'Background music only' },
            { value: 'merge', label: 'Merge Audio Levels', hint: 'Clip audio + ducked music' },
          ].map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition ${
                audioMode === option.value
                  ? 'border-indigo-500 bg-indigo-950/40'
                  : 'border-zinc-700 bg-zinc-950 hover:border-zinc-600'
              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <input
                type="radio"
                name="audioMode"
                value={option.value}
                checked={audioMode === option.value}
                disabled={disabled}
                onChange={() => onAudioModeChange(option.value)}
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
        <label htmlFor="musicQuery" className="mb-1.5 block text-xs font-medium text-zinc-300">
          Background music <span className="text-zinc-600">(fetched online, CC-licensed)</span>
        </label>
        <input
          id="musicQuery"
          type="text"
          value={musicQuery}
          maxLength={100}
          disabled={disabled}
          onChange={(e) => onMusicQueryChange(e.target.value)}
          placeholder="upbeat instrumental"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-indigo-500 disabled:opacity-50"
        />
        <p className="mt-1 text-[11px] leading-snug text-zinc-600">
          A matching track is fetched from Openverse and mixed in automatically. If offline,
          previously downloaded tracks or files in <code>server/public/audio/</code> are used.
        </p>
      </div>

      <div>
        <label htmlFor="title" className="mb-1.5 block text-xs font-medium text-zinc-300">
          Video title <span className="text-zinc-600">(optional — adds a 3s title slide)</span>
        </label>
        <input
          id="title"
          type="text"
          value={title}
          maxLength={200}
          disabled={disabled}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="e.g. Summer Retreat 2026"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-indigo-500 disabled:opacity-50"
        />
      </div>
    </section>
  );
}
