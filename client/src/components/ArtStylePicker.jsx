export const ART_STYLES = [
  { value: 'suggested', label: 'Suggested', emoji: '✨' },
  { value: 'photo', label: 'Photo', emoji: '📷' },
  { value: 'illustration', label: 'Illustration', emoji: '🎨' },
  { value: 'artwork', label: 'Artwork', emoji: '🖼️' },
  { value: 'abstract', label: 'Abstract', emoji: '🌀' },
];

/**
 * Shared Art-style chip row (Studio / Auto / Script). Meaning adapts per
 * page — see each page's hint text — but the control and its values are
 * identical everywhere so the choice feels consistent across the app.
 *
 * @param {{value: string, onChange: function, disabled: boolean, hint: string}} props
 */
export default function ArtStylePicker({ value, onChange, disabled, hint }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-zinc-300">Art style</span>
      <div className="flex flex-wrap gap-2">
        {ART_STYLES.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
              value === option.value
                ? 'border-indigo-400/60 bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-950/40'
                : 'border-zinc-700 bg-zinc-950/80 text-zinc-300 hover:-translate-y-0.5 hover:border-zinc-500'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {option.emoji} {option.label}
          </button>
        ))}
      </div>
      {hint ? <p className="mt-1.5 text-[11px] leading-snug text-zinc-600">{hint}</p> : null}
    </div>
  );
}
