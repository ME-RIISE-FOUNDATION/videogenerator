export const VIBES = [
  {
    value: 'dynamic',
    label: 'Dynamic',
    emoji: '⚡',
    hint: 'Punchy 0.35s cuts (slides & zooms), vivid color, crisp detail, energetic music — 4s clips',
  },
  {
    value: 'cinematic',
    label: 'Cinematic',
    emoji: '🎬',
    hint: 'Teal-orange film grade, grain + letterbox bars, slow dissolves, orchestral score — 6s takes',
  },
  {
    value: 'chill',
    label: 'Chill',
    emoji: '🌊',
    hint: 'Warm golden tones, soft dissolves, relaxed pacing, calm acoustic music — 5s clips',
  },
];

/**
 * The shared vibe radio cards used by the Auto Generator and Script pages.
 *
 * @param {{vibe: string, onChange: function, disabled: boolean}} props
 */
export default function VibePicker({ vibe, onChange, disabled }) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {VIBES.map((option) => (
        <label
          key={option.value}
          className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-200 ${
            vibe === option.value
              ? 'border-indigo-400/60 bg-indigo-950/40 shadow-lg shadow-indigo-950/40 ring-1 ring-indigo-400/30'
              : 'border-zinc-700 bg-zinc-950/80 hover:-translate-y-0.5 hover:border-zinc-500'
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <input
            type="radio"
            name="vibe"
            value={option.value}
            checked={vibe === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            className="mt-0.5 accent-indigo-500"
          />
          <span>
            <span className="block text-sm font-medium text-zinc-100">
              {option.emoji} {option.label}
            </span>
            <span className="block text-xs text-zinc-500">{option.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
