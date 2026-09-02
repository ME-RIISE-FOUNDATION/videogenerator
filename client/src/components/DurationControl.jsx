/**
 * Total-video-length picker for Studio and Auto Generate.
 *
 * Value is a string of seconds, or '' for "Auto" (pace to content — the app's
 * original behavior). Presets mirror the Avatar mode picker; a custom box covers
 * 15–300s. When the length is set, the server paces the uploaded media to hit it.
 *
 * @param {{value: string, onChange: function(string):void, disabled?: boolean,
 *   hint?: string}} props
 */
const PRESETS = [
  { value: '', label: 'Auto' },
  { value: '15', label: '15s' },
  { value: '30', label: '30s' },
  { value: '45', label: '45s' },
  { value: '60', label: '60s' },
];

export default function DurationControl({ value, onChange, disabled, hint }) {
  const isPreset = PRESETS.some((p) => p.value === value);

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-300">
        Total length
      </label>
      <div className="grid grid-cols-5 gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.value || 'auto'}
            type="button"
            onClick={() => onChange(preset.value)}
            disabled={disabled}
            className={`rounded-lg border px-1 py-2 text-xs font-medium transition-all ${
              value === preset.value
                ? 'border-indigo-400 bg-indigo-600 text-white shadow-lg shadow-indigo-950/40'
                : 'border-zinc-700 bg-zinc-950/80 text-zinc-300 hover:border-zinc-500'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
        <span>Custom:</span>
        <input
          type="number"
          min="15"
          max="300"
          value={isPreset ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="15-300s"
          className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 disabled:opacity-50"
        />
        <span className="text-zinc-600">seconds</span>
      </label>
      <p className="mt-1 text-[11px] leading-snug text-zinc-600">
        {hint ||
          'Auto fits to your clips. Pick a length and your photos/clips are paced to fit it (a title slide adds 3s on top).'}
      </p>
    </div>
  );
}
