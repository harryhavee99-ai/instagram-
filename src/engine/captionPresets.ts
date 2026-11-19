import type {
  CaptionAnimationType,
  CaptionStylePreset,
  MotionGraphicItem,
} from '../types/project';

export const CAPTION_STYLE_PRESETS: Record<
  CaptionStylePreset,
  {
    label: CaptionStylePreset;
    description: string;
    patch: Partial<MotionGraphicItem>;
  }
> = {
  'Bold Hormozi': {
    label: 'Bold Hormozi',
    description: 'Heavy uppercase sans with thick black outline and yellow keyword pop',
    patch: {
      captionStylePreset: 'Bold Hormozi',
      fontFamily: 'Outfit',
      fontWeight: 900,
      fontSize: 48,
      colorHex: '#FFFFFF',
      outlineColorHex: '#000000',
      outlineWidthPx: 4,
      backgroundColorHex: '#000000',
      backgroundOpacity: 0,
      highlightColorHex: '#FACC15',
      textTransform: 'uppercase',
      hasShadow: true,
      animationType: 'Bounce Pop',
      animationDurationSec: 0.25,
    },
  },
  'Karaoke Highlight': {
    label: 'Karaoke Highlight',
    description: 'Word-by-word active green/gold highlight sweep across the phrase',
    patch: {
      captionStylePreset: 'Karaoke Highlight',
      fontFamily: 'Outfit',
      fontWeight: 800,
      fontSize: 44,
      colorHex: '#FFFFFF',
      outlineColorHex: '#000000',
      outlineWidthPx: 3,
      backgroundColorHex: '#000000',
      backgroundOpacity: 35,
      highlightColorHex: '#4ADE80',
      textTransform: 'uppercase',
      hasShadow: true,
      animationType: 'Karaoke Sweep',
      animationDurationSec: 0.3,
    },
  },
  'Boxed Pill': {
    label: 'Boxed Pill',
    description: 'Clean high-contrast solid backdrop box behind crisp bold text',
    patch: {
      captionStylePreset: 'Boxed Pill',
      fontFamily: 'DM Sans',
      fontWeight: 700,
      fontSize: 38,
      colorHex: '#FFFFFF',
      outlineColorHex: '#000000',
      outlineWidthPx: 0,
      backgroundColorHex: '#0B0C10',
      backgroundOpacity: 82,
      highlightColorHex: '#7C5CFF',
      textTransform: 'none',
      hasShadow: false,
      animationType: 'Slide Up',
      animationDurationSec: 0.28,
    },
  },
  'Neon Glow': {
    label: 'Neon Glow',
    description: 'Luminous violet/cyan glow pulse for music & nightlife Reels',
    patch: {
      captionStylePreset: 'Neon Glow',
      fontFamily: 'Outfit',
      fontWeight: 800,
      fontSize: 46,
      colorHex: '#F8FAFC',
      outlineColorHex: '#7C5CFF',
      outlineWidthPx: 2,
      backgroundColorHex: '#000000',
      backgroundOpacity: 0,
      highlightColorHex: '#38BDF8',
      textTransform: 'uppercase',
      hasShadow: true,
      animationType: 'Glow Pulse',
      animationDurationSec: 0.35,
    },
  },
  'Outline Impact': {
    label: 'Outline Impact',
    description: 'Ultra-thick stroke outline with punchy kinetic scale animation',
    patch: {
      captionStylePreset: 'Outline Impact',
      fontFamily: 'Outfit',
      fontWeight: 900,
      fontSize: 50,
      colorHex: '#FFFFFF',
      outlineColorHex: '#000000',
      outlineWidthPx: 6,
      backgroundColorHex: '#000000',
      backgroundOpacity: 0,
      highlightColorHex: '#FB7185',
      textTransform: 'uppercase',
      hasShadow: true,
      animationType: 'Kinetic Scale',
      animationDurationSec: 0.24,
    },
  },
  'Minimal Clean': {
    label: 'Minimal Clean',
    description: 'Subtle editorial subtitle styling with gentle fade transition',
    patch: {
      captionStylePreset: 'Minimal Clean',
      fontFamily: 'DM Sans',
      fontWeight: 600,
      fontSize: 34,
      colorHex: '#F1F5F9',
      outlineColorHex: '#000000',
      outlineWidthPx: 1,
      backgroundColorHex: '#000000',
      backgroundOpacity: 0,
      highlightColorHex: '#FFFFFF',
      textTransform: 'none',
      hasShadow: true,
      animationType: 'Fade',
      animationDurationSec: 0.35,
    },
  },
  'Typewriter Mono': {
    label: 'Typewriter Mono',
    description: 'Monospace character-by-character typewriter reveal on dark plate',
    patch: {
      captionStylePreset: 'Typewriter Mono',
      fontFamily: 'JetBrains Mono',
      fontWeight: 700,
      fontSize: 34,
      colorHex: '#E2E8F0',
      outlineColorHex: '#000000',
      outlineWidthPx: 0,
      backgroundColorHex: '#0F172A',
      backgroundOpacity: 78,
      highlightColorHex: '#38BDF8',
      textTransform: 'none',
      hasShadow: false,
      animationType: 'Typewriter',
      animationDurationSec: 0.6,
    },
  },
};

export const CAPTION_ANIMATION_OPTIONS: CaptionAnimationType[] = [
  'Bounce Pop',
  'Word Highlight',
  'Karaoke Sweep',
  'Pop In',
  'Slide Up',
  'Kinetic Scale',
  'Typewriter',
  'Glow Pulse',
  'Fade',
  'None',
];

export const CAPTION_PRESET_NAMES: CaptionStylePreset[] = Object.keys(
  CAPTION_STYLE_PRESETS
) as CaptionStylePreset[];

export function hexToRgba(hex: string | undefined, opacityPercent: number | undefined): string {
  const op = Math.max(0, Math.min(100, opacityPercent ?? 0)) / 100;
  if (op <= 0) return 'transparent';
  const clean = (hex || '#000000').replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${op.toFixed(2)})`;
}

export function formatSrtTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(Math.min(999, ms), 3)}`;
}

/**
 * Generates a standard SubRip (.srt) file directly importable into
 * Adobe Premiere Pro (File > Import > drag onto Captions track).
 */
export function generateSrtSubtitles(graphics: MotionGraphicItem[]): string {
  const sorted = [...graphics]
    .filter((g) => g.text.trim().length > 0)
    .sort((a, b) => a.startTimeSec - b.startTimeSec);

  if (sorted.length === 0) return '';

  return sorted
    .map((g, idx) => {
      const start = formatSrtTimecode(g.startTimeSec);
      const end = formatSrtTimecode(Math.max(g.startTimeSec + 0.15, g.endTimeSec));
      const cleanText = g.text.replace(/\s+/g, ' ').trim();
      const formatted =
        g.textTransform === 'uppercase'
          ? cleanText.toUpperCase()
          : g.textTransform === 'capitalize'
          ? cleanText.replace(/\b\w/g, (c) => c.toUpperCase())
          : cleanText;
      return `${idx + 1}\n${start} --> ${end}\n${formatted}\n`;
    })
    .join('\n');
}
