/**
 * Cinematic color grading presets using FFmpeg filters.
 * Each preset returns an FFmpeg filter string for consistent cinematic look.
 */

const PRESETS = {
  subtle: {
    name: 'Subtle',
    description: 'Slight warm highlights, minimal teal',
    // Subtle warmth, slight contrast boost, minimal saturation increase
    filterStr:
      "eq=contrast=1.05:brightness=0:saturation=1.05," +
      "colorchannelmixer=0.95:0.05:0:0.05:1:0:0:0.95:0.05," +
      "drawbox=x=0:y=0:w=iw:h=ih:color=0x000000@0.02:t=fill",
  },

  cinematic: {
    name: 'Cinematic',
    description: 'Golden shadows, teal highlights, film grain',
    // Warm tones in shadows, cool tones in highlights, high contrast, saturated
    filterStr:
      "eq=contrast=1.15:brightness=0.02:saturation=1.12," +
      "colormatrix=bt601:bt709," +
      "curves=r='0/15 64/70 128/128 192/210 255/255':g='0/10 64/65 128/128 192/205 255/255':b='0/20 64/90 128/128 192/160 255/240'," +
      "drawbox=x=0:y=0:w=iw:h=ih:color=0xFFD700@0.08:t=fill," +
      "drawbox=x=0:y=0:w=iw:h=ih:color=0x00CCFF@0.05:t=fill," +
      "format=yuv420p",
  },

  ultra: {
    name: 'Ultra',
    description: 'Maximum contrast, bold warm/teal, bloom effects',
    // Maximum contrast, aggressive warm/cool split, heavy saturation, vignette
    filterStr:
      "eq=contrast=1.25:brightness=0.05:saturation=1.25," +
      "colormatrix=bt601:bt709," +
      "curves=r='0/20 64/80 128/128 192/220 255/255':g='0/5 64/60 128/128 192/210 255/255':b='0/30 64/100 128/128 192/170 255/235'," +
      "drawbox=x=0:y=0:w=iw:h=ih:color=0xFFD700@0.12:t=fill," +
      "drawbox=x=0:y=0:w=iw:h=ih:color=0x00CCFF@0.08:t=fill," +
      "drawbox=x=0:y=0:w=iw:h=ih:color=0x000000@0.15:t=fill," +
      "format=yuv420p",
  },
};

/**
 * Get the FFmpeg filter string for a color grade preset.
 * @param {string} presetName One of: 'subtle', 'cinematic', 'ultra'
 * @returns {string} FFmpeg filter string
 */
export function getColorGradeFilter(presetName) {
  const preset = PRESETS[presetName] || PRESETS.cinematic;
  return preset.filterStr;
}

/**
 * Get metadata about a preset.
 * @param {string} presetName
 * @returns {object} { name, description }
 */
export function getPresetInfo(presetName) {
  const preset = PRESETS[presetName] || PRESETS.cinematic;
  return { name: preset.name, description: preset.description };
}

/**
 * List all available presets.
 * @returns {Array<{id: string, name: string, description: string}>}
 */
export function listPresets() {
  return Object.entries(PRESETS).map(([id, preset]) => ({
    id,
    name: preset.name,
    description: preset.description,
  }));
}
