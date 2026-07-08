
export const FFT_SIZE = 1024;
export const SMOOTHING_TIME_CONSTANT = 0.8;
export const SCRUB_GRAIN_DURATION = 0.05; // 50ms

export const COLORS = {
  VOCAL_WAVE: '#ffaa00', // Amber/Orange for Bass/Vowels
  INST_WAVE: '#00f2ff',  // Cyan for Treble/Consonants
  BG_ANIMATO: '#050505',
};

export const FREQ_BANDS = {
  LOW_MAX: 300,
  MID_MIN: 500,
  MID_MAX: 2000,
  HIGH_MIN: 4000,
};

// Distinct colors for up to 8 bones, then repeats. High contrast for visibility.
export const BONE_PALETTE = [
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#22c55e', // Green
  '#eab308', // Yellow
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#f97316', // Orange
  '#06b6d4', // Cyan
];
