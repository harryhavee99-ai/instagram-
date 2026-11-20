import type { AudioSection, MotionGraphicItem, SfxEvent } from '../types/project';

/**
 * Pure TypeScript 48kHz 16-bit Stereo PCM WAV synthesizer for Adobe Premiere Pro
 * sound design layers (Music beds, Whooshes, Impacts, Risers, Drops, Bass Hits,
 * Clicks, Swishes, Ambient pads, and Voiceover timing stems).
 *
 * Runs client-side in milliseconds with zero external dependencies so every
 * sound design track in Premiere Pro opens with real, playable audio clips.
 */

const DEFAULT_SAMPLE_RATE = 48000;

export function encodeStereoWav(
  left: Float32Array,
  right: Float32Array,
  sampleRate = DEFAULT_SAMPLE_RATE
): Uint8Array {
  const numFrames = Math.min(left.length, right.length);
  const numChannels = 2;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }

  return new Uint8Array(buffer);
}

// Deterministic fast PRNG for clean repeatable stereo noise
function createSeededRandom(seed: number) {
  let state = seed >>> 0 || 123456789;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

export function generateSfxWav(sfx: SfxEvent, sampleRate = DEFAULT_SAMPLE_RATE): Uint8Array {
  const dur = Math.max(0.15, Math.min(4.0, sfx.durationSec || 0.45));
  const totalSamples = Math.round(dur * sampleRate);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);
  const rand = createSeededRandom(Math.round((sfx.timeSec + 1) * 9973) + sfx.label.length * 31);
  const gain = Math.min(0.92, Math.pow(10, (sfx.volumeDb ?? -2) / 20) * 0.78);

  let lpL = 0;
  let lpR = 0;
  let phase = 0;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const norm = i / Math.max(1, totalSamples - 1);
    const whiteL = rand() * 2 - 1;
    const whiteR = rand() * 2 - 1;

    let sampleL = 0;
    let sampleR = 0;

    switch (sfx.category) {
      case 'Whoosh':
      case 'Swish':
      case 'Transition SFX': {
        // Stereo Doppler swept bandpass noise
        const env = Math.sin(Math.PI * Math.pow(norm, 0.85));
        const cutoff =
          sfx.category === 'Swish'
            ? 0.08 + Math.sin(Math.PI * norm) * 0.48
            : 0.03 + Math.sin(Math.PI * norm) * 0.28;
        lpL += cutoff * (whiteL - lpL);
        lpR += cutoff * (whiteR - lpR);
        const pan = sfx.category === 'Swish' ? norm : 0.25 + norm * 0.5;
        const air = Math.sin(2 * Math.PI * (140 + norm * 320) * t) * 0.14;
        sampleL = (lpL * 1.35 + air) * env * (1 - pan * 0.45);
        sampleR = (lpR * 1.35 + air) * env * (0.55 + pan * 0.45);
        break;
      }

      case 'Impact':
      case 'Drop': {
        // Deep cinematic sub pitch drop + crisp initial transient punch
        const startFreq = sfx.category === 'Drop' ? 135 : 165;
        const endFreq = sfx.category === 'Drop' ? 32 : 42;
        const freq = endFreq + (startFreq - endFreq) * Math.exp(-t * 9.5);
        phase += (2 * Math.PI * freq) / sampleRate;
        const subEnv = Math.exp(-t * (sfx.category === 'Drop' ? 3.2 : 5.5));
        const crackEnv = Math.exp(-t * 42);
        lpL += 0.35 * (whiteL - lpL);
        lpR += 0.35 * (whiteR - lpR);
        const body = Math.tanh(Math.sin(phase) * 1.8) * subEnv * 0.85;
        sampleL = body + lpL * crackEnv * 0.55;
        sampleR = body + lpR * crackEnv * 0.55;
        break;
      }

      case 'Bass Hit': {
        // Tight punchy 808 bass hit
        const freq = 48 + 95 * Math.exp(-t * 24);
        phase += (2 * Math.PI * freq) / sampleRate;
        const env = Math.min(1, t / 0.004) * Math.exp(-t * 4.2);
        const val = Math.tanh(Math.sin(phase) * 2.1 + Math.sin(phase * 2) * 0.25) * env * 0.82;
        sampleL = val;
        sampleR = val;
        break;
      }

      case 'Riser': {
        // Rising cinematic sweep + harmonic tension shimmer
        const env = Math.pow(norm, 1.8) * (norm > 0.94 ? (1 - norm) / 0.06 : 1);
        const freq = 90 + Math.pow(norm, 2.2) * 1150;
        phase += (2 * Math.PI * freq) / sampleRate;
        const cutoff = 0.02 + Math.pow(norm, 2) * 0.45;
        lpL += cutoff * (whiteL - lpL);
        lpR += cutoff * (whiteR - lpR);
        const harmonic = (Math.sin(phase) * 0.35 + Math.sin(phase * 1.5) * 0.18) * env;
        sampleL = (lpL * 0.85 + harmonic) * env;
        sampleR = (lpR * 0.85 + harmonic) * env;
        break;
      }

      case 'Click': {
        // Crisp short UI / camera shutter transient click
        const env = Math.exp(-t * 85);
        const tone = Math.sin(2 * Math.PI * 2400 * t) * 0.55 + Math.sin(2 * Math.PI * 4100 * t) * 0.3;
        sampleL = (tone + whiteL * 0.35) * env;
        sampleR = (tone + whiteR * 0.35) * env;
        break;
      }

      case 'Ambient':
      default: {
        // Warm stereo atmospheric pad/room tone
        const fade = Math.min(1, norm / 0.15) * Math.min(1, (1 - norm) / 0.15);
        lpL += 0.018 * (whiteL - lpL);
        lpR += 0.018 * (whiteR - lpR);
        const pad =
          (Math.sin(2 * Math.PI * 110 * t) * 0.18 +
            Math.sin(2 * Math.PI * 164.81 * t) * 0.12 +
            Math.sin(2 * Math.PI * 220 * t) * 0.08) *
          0.5;
        sampleL = (lpL * 0.9 + pad) * fade;
        sampleR = (lpR * 0.9 + pad * 0.95) * fade;
        break;
      }
    }

    left[i] = sampleL * gain;
    right[i] = sampleR * gain;
  }

  return encodeStereoWav(left, right, sampleRate);
}

/**
 * Generates a subtle tempo-synced rhythmic beat/sub-pulse reference stem (.wav)
 * for each detected Music section on Track A2 in Premiere Pro.
 */
export function generateMusicSectionWav(
  section: AudioSection,
  bpm: number,
  sampleRate = DEFAULT_SAMPLE_RATE
): Uint8Array {
  const dur = Math.max(0.5, Math.min(25, section.endTimeSec - section.startTimeSec));
  const totalSamples = Math.round(dur * sampleRate);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);
  const safeBpm = Math.max(60, Math.min(200, bpm || 120));
  const beatInterval = 60 / safeBpm;
  const energyGain = 0.16 + (Math.max(10, Math.min(100, section.energyLevel || 60)) / 100) * 0.26;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const norm = i / Math.max(1, totalSamples - 1);
    const fade = Math.min(1, norm / 0.05) * Math.min(1, (1 - norm) / 0.06);

    const beatIndex = Math.floor(t / beatInterval);
    const beatRel = t - beatIndex * beatInterval;
    const isDownbeat = beatIndex % 4 === 0;

    // Gentle tempo kick pulse on beat + warm chord drone underneath
    const kickFreq = isDownbeat ? 56 + 70 * Math.exp(-beatRel * 28) : 64 + 45 * Math.exp(-beatRel * 32);
    const kickEnv = Math.exp(-beatRel * 11) * (isDownbeat ? 0.65 : 0.4);
    const kick = Math.sin(2 * Math.PI * kickFreq * beatRel) * kickEnv;

    const pad =
      (Math.sin(2 * Math.PI * 130.81 * t) * 0.18 +
        Math.sin(2 * Math.PI * 196.0 * t) * 0.14 +
        Math.sin(2 * Math.PI * 246.94 * t) * 0.1) *
      0.55;

    const val = (kick + pad) * energyGain * fade;
    left[i] = val;
    right[i] = val * 0.98;
  }

  return encodeStereoWav(left, right, sampleRate);
}

/**
 * Generates a clean, quiet voiceover timing cue guide (.wav) for Track A5
 * so editors have an aligned clip placeholder on the Voiceover/Dialogue track.
 */
export function generateVoiceoverCueWav(
  durationSec: number,
  sampleRate = DEFAULT_SAMPLE_RATE
): Uint8Array {
  const dur = Math.max(0.3, Math.min(20, durationSec));
  const totalSamples = Math.round(dur * sampleRate);
  const left = new Float32Array(totalSamples);
  const right = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Ultra-subtle marker tone on first 25ms, then digital silence so it never clashes with A1 dialogue
    const val = t < 0.025 ? Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 95) * 0.08 : 0;
    left[i] = val;
    right[i] = val;
  }

  return encodeStereoWav(left, right, sampleRate);
}

/**
 * Splits items into non-overlapping lanes (Primary + Secondary) so overlapping
 * Captions (V3/V4) or overlapping Sound Design SFX (A3/A4) never collide in Premiere.
 */
export function splitIntoNonOverlappingLanes<
  T extends { startTimeSec: number; endTimeSec: number },
>(items: T[]): { primary: T[]; secondary: T[] } {
  const sorted = [...items].sort((a, b) => a.startTimeSec - b.startTimeSec);
  const primary: T[] = [];
  const secondary: T[] = [];
  let primaryEnd = -1;

  for (const item of sorted) {
    if (item.startTimeSec >= primaryEnd - 0.02) {
      primary.push(item);
      primaryEnd = item.endTimeSec;
    } else {
      secondary.push(item);
    }
  }

  return { primary, secondary };
}

export function splitGraphicsToCaptionLanes(graphics: MotionGraphicItem[]): {
  v3Primary: MotionGraphicItem[];
  v4Secondary: MotionGraphicItem[];
} {
  const { primary, secondary } = splitIntoNonOverlappingLanes(graphics);
  return { v3Primary: primary, v4Secondary: secondary };
}

export function splitSfxToAudioLanes(sfxEvents: SfxEvent[]): {
  a3Primary: Array<SfxEvent & { startTimeSec: number; endTimeSec: number }>;
  a4Secondary: Array<SfxEvent & { startTimeSec: number; endTimeSec: number }>;
} {
  const normalized = sfxEvents.map((s) => ({
    ...s,
    startTimeSec: Math.max(0, s.timeSec),
    endTimeSec: Math.max(s.timeSec + 0.15, s.timeSec + (s.durationSec || 0.35)),
  }));
  const { primary, secondary } = splitIntoNonOverlappingLanes(normalized);
  return { a3Primary: primary, a4Secondary: secondary };
}
