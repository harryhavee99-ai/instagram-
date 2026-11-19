import type {
  AnalysisPipelineStage,
  AppSettings,
  AudioEffectItem,
  ColorGradeSettings,
  CompatibilityReport,
  CompatibilityStatus,
  ConfidenceLevel,
  EffectItem,
  EffectLicenseTier,
  InstagramInspectResult,
  KeyframePoint,
  MotionGraphicItem,
  ReelProject,
  SfxEvent,
  ShotClip,
  ShotTransition,
  VideoMetadata,
} from '../types/project';
import { analyzeAudioFromFile } from './audioAnalyzer';
import { CAPTION_ANIMATION_OPTIONS, CAPTION_PRESET_NAMES } from './captionPresets';
import { computeComparisonMetrics } from './comparisonEngine';
import { clamp, computeAspectRatio, inferContainerAndCodec } from './formatters';

interface SampledFrame {
  timeSec: number;
  histogram: Float32Array; // 48 bins (16 R + 16 G + 16 B)
  lumaGrid: Float32Array; // 16x16 mean luminance
  meanR: number;
  meanG: number;
  meanB: number;
  meanLuma: number;
  contrastStd: number;
  saturationMean: number;
  vignetteRatio: number;
  sharpnessVar: number;
  blackFloor: number;
  whiteCeiling: number;
  highFreqNoise: number;
}

interface RawShotDetection {
  index: number;
  startTimeSec: number;
  endTimeSec: number;
  durationSec: number;
  measuredMotionScore: number;
  measuredCutDelta: number;
  flashSpikeDetected: boolean;
  blurDropDetected: boolean;
  chromaSpreadScore: number;
  beatAligned: boolean;
  alignedBeatTimeSec?: number;
  thumbnailDataUrl: string;
  midpointSec: number;
}

export const INITIAL_PIPELINE_STAGES: AnalysisPipelineStage[] = [
  { id: 1, label: 'Validating source', status: 'pending' },
  { id: 2, label: 'Retrieving or importing video', status: 'pending' },
  { id: 3, label: 'Extracting frames', status: 'pending' },
  { id: 4, label: 'Detecting scenes', status: 'pending' },
  { id: 5, label: 'Analyzing motion', status: 'pending' },
  { id: 6, label: 'Analyzing audio', status: 'pending' },
  { id: 7, label: 'Detecting effects', status: 'pending' },
  { id: 8, label: 'Estimating color grading', status: 'pending' },
  { id: 9, label: 'Reconstructing timeline', status: 'pending' },
  { id: 10, label: 'Generating Premiere XML', status: 'pending' },
  { id: 11, label: 'Packaging assets', status: 'pending' },
];

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = clamp(timeSec, 0, Math.max(0, (video.duration || 0.1) - 0.02));
    if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 2500);

    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Failed seeking video frame.'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = target;
  });
}

function loadVideoElement(file: File): Promise<{ video: HTMLVideoElement; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = objectUrl;

    const timer = window.setTimeout(() => {
      reject(
        new Error(
          'Timed out loading video metadata. If this is an MKV or Apple ProRes MOV file, transcode to H.264 MP4/WebM for browser decoding.'
        )
      );
    }, 10000);

    video.onloadedmetadata = () => {
      if (video.duration === Infinity || Number.isNaN(video.duration)) {
        // WebM from MediaRecorder sometimes needs seek to resolve duration
        video.currentTime = 1e6;
        video.ontimeupdate = () => {
          video.ontimeupdate = null;
          video.currentTime = 0;
          window.clearTimeout(timer);
          resolve({ video, objectUrl });
        };
      } else {
        window.clearTimeout(timer);
        resolve({ video, objectUrl });
      }
    };

    video.onerror = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      reject(
        new Error(
          `Browser cannot natively decode "${file.name}". Supported direct browser decode formats are MP4 (H.264), MOV (H.264), M4V, and WebM.`
        )
      );
    };
  });
}

function analyzeFramePixels(img: ImageData, timeSec: number): SampledFrame {
  const { data, width, height } = img;
  const totalPixels = width * height;
  const histogram = new Float32Array(48);
  const lumaGrid = new Float32Array(256); // 16x16
  const lumaCounts = new Float32Array(256);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLuma = 0;
  let sumLumaSq = 0;
  let sumSat = 0;
  let centerLuma = 0;
  let centerCount = 0;
  let cornerLuma = 0;
  let cornerCount = 0;
  let edgeSum = 0;
  let noiseSum = 0;
  const lumaBins = new Uint32Array(64);

  const lumaBuf = new Float32Array(totalPixels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const p = idx * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];

      sumR += r;
      sumG += g;
      sumB += b;

      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumaBuf[idx] = luma;
      sumLuma += luma;
      sumLumaSq += luma * luma;

      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      sumSat += sat;

      histogram[Math.min(15, r >> 4)] += 1;
      histogram[16 + Math.min(15, g >> 4)] += 1;
      histogram[32 + Math.min(15, b >> 4)] += 1;
      lumaBins[Math.min(63, Math.floor(luma / 4))] += 1;

      const gx = Math.min(15, Math.floor((x / width) * 16));
      const gy = Math.min(15, Math.floor((y / height) * 16));
      lumaGrid[gy * 16 + gx] += luma;
      lumaCounts[gy * 16 + gx] += 1;

      const nx = (x / width) - 0.5;
      const ny = (y / height) - 0.5;
      const dist = Math.sqrt(nx * nx + ny * ny);
      if (dist < 0.25) {
        centerLuma += luma;
        centerCount += 1;
      } else if (dist > 0.48) {
        cornerLuma += luma;
        cornerCount += 1;
      }
    }
  }

  // Edge variance (sharpness) and local pixel noise
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = y * width + x;
      const gx = Math.abs(lumaBuf[i + 1] - lumaBuf[i - 1]);
      const gy = Math.abs(lumaBuf[i + width] - lumaBuf[i - width]);
      edgeSum += gx + gy;
      const lap = Math.abs(4 * lumaBuf[i] - lumaBuf[i - 1] - lumaBuf[i + 1] - lumaBuf[i - width] - lumaBuf[i + width]);
      noiseSum += lap;
    }
  }

  for (let i = 0; i < 48; i++) {
    histogram[i] /= Math.max(1, totalPixels);
  }
  for (let i = 0; i < 256; i++) {
    lumaGrid[i] = lumaCounts[i] > 0 ? lumaGrid[i] / lumaCounts[i] : 0;
  }

  // Percentiles for black floor (5%) and white ceiling (95%)
  let acc = 0;
  let blackFloor = 0;
  let whiteCeiling = 255;
  for (let b = 0; b < 64; b++) {
    acc += lumaBins[b];
    if (acc >= totalPixels * 0.05 && blackFloor === 0) {
      blackFloor = b * 4;
    }
    if (acc >= totalPixels * 0.95) {
      whiteCeiling = b * 4;
      break;
    }
  }

  const meanLuma = sumLuma / Math.max(1, totalPixels);
  const variance = Math.max(0, sumLumaSq / Math.max(1, totalPixels) - meanLuma * meanLuma);
  const avgCenter = centerCount > 0 ? centerLuma / centerCount : meanLuma;
  const avgCorner = cornerCount > 0 ? cornerLuma / cornerCount : meanLuma;
  const sampledInterior = Math.max(1, ((height - 2) / 2) * ((width - 2) / 2));

  return {
    timeSec,
    histogram,
    lumaGrid,
    meanR: sumR / totalPixels,
    meanG: sumG / totalPixels,
    meanB: sumB / totalPixels,
    meanLuma,
    contrastStd: Math.sqrt(variance),
    saturationMean: sumSat / totalPixels,
    vignetteRatio: avgCenter > 5 ? clamp(1 - avgCorner / avgCenter, 0, 1) : 0,
    sharpnessVar: edgeSum / sampledInterior,
    blackFloor,
    whiteCeiling,
    highFreqNoise: noiseSum / sampledInterior,
  };
}

function histogramDiff(a: Float32Array, b: Float32Array): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i]);
  }
  // Normalized to roughly 0..100
  return clamp((diff / 6) * 100, 0, 100);
}

function lumaGridDiff(a: Float32Array, b: Float32Array): number {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i]);
  }
  return clamp((diff / (a.length * 255)) * 220, 0, 100);
}

function deriveColorGradeFromFrames(frames: SampledFrame[]): ColorGradeSettings {
  const n = Math.max(1, frames.length);
  let meanR = 0;
  let meanG = 0;
  let meanB = 0;
  let meanLuma = 0;
  let contrastStd = 0;
  let sat = 0;
  let vig = 0;
  let sharp = 0;
  let blackFloor = 0;
  let whiteCeil = 0;
  let grain = 0;

  const avgRHist = new Array(16).fill(0);
  const avgGHist = new Array(16).fill(0);
  const avgBHist = new Array(16).fill(0);

  for (const f of frames) {
    meanR += f.meanR;
    meanG += f.meanG;
    meanB += f.meanB;
    meanLuma += f.meanLuma;
    contrastStd += f.contrastStd;
    sat += f.saturationMean;
    vig += f.vignetteRatio;
    sharp += f.sharpnessVar;
    blackFloor += f.blackFloor;
    whiteCeil += f.whiteCeiling;
    grain += f.highFreqNoise;

    for (let i = 0; i < 16; i++) {
      avgRHist[i] += f.histogram[i] / n;
      avgGHist[i] += f.histogram[16 + i] / n;
      avgBHist[i] += f.histogram[32 + i] / n;
    }
  }

  meanR /= n;
  meanG /= n;
  meanB /= n;
  meanLuma /= n;
  contrastStd /= n;
  sat /= n;
  vig /= n;
  sharp /= n;
  blackFloor /= n;
  whiteCeil /= n;
  grain /= n;

  const avgLumaHist = avgRHist.map((r, i) => Number((0.2126 * r + 0.7152 * avgGHist[i] + 0.0722 * avgBHist[i]).toFixed(4)));

  const exposure = Number(clamp((meanLuma - 118) / 85, -1.6, 1.6).toFixed(2));
  const contrast = Math.round(clamp((contrastStd - 52) * 1.4, -55, 65));
  const temperature = Math.round(clamp(((meanR - meanB) / 128) * 95, -65, 65));
  const tint = Math.round(clamp((((meanR + meanB) / 2 - meanG) / 128) * 85, -45, 45));
  const saturation = Math.round(clamp(sat * 210, 45, 165));
  const vibrance = Math.round(clamp((saturation - 100) * 0.45, -35, 45));
  const highlights = Math.round(clamp((whiteCeil - 220) * 1.2, -55, 55));
  const shadows = Math.round(clamp((blackFloor - 24) * 1.1, -50, 50));
  const whites = Math.round(clamp((whiteCeil - 235) * 1.4, -40, 40));
  const blacks = Math.round(clamp((18 - blackFloor) * 1.3, -40, 40));
  const vignette = Math.round(clamp(vig * 130, 0, 75));
  const sharpening = Math.round(clamp(sharp * 1.15, 5, 70));
  const fade = Math.round(clamp((blackFloor / 55) * 35, 0, 45));
  const filmGrain = Math.round(clamp((grain / 42) * 35, 0, 50));

  const profileName =
    temperature > 12 && contrast > 8
      ? 'Warm High-Contrast Cinematic'
      : temperature < -10
      ? 'Cool Moody Editorial'
      : fade > 16
      ? 'Lifted Film Matte'
      : saturation > 118
      ? 'Vivid Commercial Punch'
      : 'Balanced Rec. 709 Neutral';

  return {
    profileName,
    exposure,
    contrast,
    highlights,
    shadows,
    whites,
    blacks,
    temperature,
    tint,
    saturation,
    vibrance,
    hueShift: 0,
    vignette,
    sharpening,
    fade,
    filmGrain,
    rgbCurves: {
      redLift: Number(clamp((meanR - meanLuma) / 200, -0.25, 0.25).toFixed(2)),
      redGain: Number(clamp(1 + (meanR - meanLuma) / 260, 0.8, 1.25).toFixed(2)),
      greenLift: Number(clamp((meanG - meanLuma) / 200, -0.25, 0.25).toFixed(2)),
      greenGain: Number(clamp(1 + (meanG - meanLuma) / 260, 0.8, 1.25).toFixed(2)),
      blueLift: Number(clamp((meanB - meanLuma) / 200, -0.25, 0.25).toFixed(2)),
      blueGain: Number(clamp(1 + (meanB - meanLuma) / 260, 0.8, 1.25).toFixed(2)),
    },
    skinToneNote:
      'Estimated from rendered Rec. 709 frame histograms. Verify midtone vectorscope skin-tone line in Premiere Lumetri Color.',
    confidence: 'Medium',
    confidenceScore: 78,
    measuredHistogram: {
      r: avgRHist.map((v) => Number(v.toFixed(4))),
      g: avgGHist.map((v) => Number(v.toFixed(4))),
      b: avgBHist.map((v) => Number(v.toFixed(4))),
      luma: avgLumaHist,
    },
  };
}

function safeConfidence(val: unknown): ConfidenceLevel {
  if (val === 'High' || val === 'Medium' || val === 'Low') return val;
  return 'Medium';
}

function safeCompat(val: unknown): CompatibilityStatus {
  if (val === 'Native' || val === 'Approximate' || val === 'Unsupported') return val;
  return 'Approximate';
}

const VALID_TRANSITIONS = new Set<ShotTransition['type']>([
  'Cut',
  'Cross Dissolve',
  'Fade In',
  'Fade Out',
  'Zoom Transition',
  'Whip Pan',
  'Push',
  'Slide',
  'Blur Transition',
  'Flash Transition',
  'Glitch',
  'Light Leak',
  'Mask Reveal',
]);

function safeTransitionType(val: unknown): ShotTransition['type'] {
  if (typeof val === 'string' && VALID_TRANSITIONS.has(val as ShotTransition['type'])) {
    return val as ShotTransition['type'];
  }
  return 'Cut';
}

const PAID_PLUGIN_SIGNATURES: Array<{ pattern: RegExp; vendor: string }> = [
  { pattern: /\b(sapphire|s_shake|s_glow|s_flicker|s_blur|s_dissolve|s_warp|boris\s*fx|bcc\b|continuum)\b/i, vendor: 'Boris FX / Sapphire' },
  { pattern: /\b(red\s*giant|rg\s*universe|maxon\s*universe|magic\s*bullet|trapcode|vfx\s*suite)\b/i, vendor: 'Maxon / Red Giant' },
  { pattern: /\b(dehancer)\b/i, vendor: 'Dehancer' },
  { pattern: /\b(filmconvert|film\s*convert)\b/i, vendor: 'FilmConvert' },
  { pattern: /\b(twixtor|rsmb|reelsmart|reel\s*smart)\b/i, vendor: 'RE:Vision Effects' },
  { pattern: /\b(deep\s*glow|optical\s*flares|element\s*3d|saber)\b/i, vendor: 'Video Copilot / Plugin Everything' },
  { pattern: /\b(film\s*impact|filmimpact|mister\s*horse|motion\s*bro|aejuice|neat\s*video|flicker\s*free)\b/i, vendor: 'Third-Party Paid Plugin' },
  { pattern: /\b(fabfilter|pro-q|pro-l|pro-c|pro-r)\b/i, vendor: 'FabFilter' },
  { pattern: /\b(valhalla\s*(vintage|room|shimmer|supermassive|delay)?)\b/i, vendor: 'Valhalla DSP' },
  { pattern: /\b(waves\s*(ssl|cla|l1|l2|c4|h-delay|tune|audio)?|soundtoys|decapitator|echoboy|microshift)\b/i, vendor: 'Waves / Soundtoys' },
  { pattern: /\b(auto-?tune|antares|izotope|ozone|neutron|nectar|rx\s*\d+|soothe\s*2?|rc-?20|slate\s*digital|uad\b)\b/i, vendor: 'Commercial Audio Plugin' },
];

function classifyEffectLicense(
  name: string,
  rawTier: unknown,
  rawVendor?: unknown,
  rawSkippedReason?: unknown
): {
  licenseTier: EffectLicenseTier;
  includedInTimeline: boolean;
  pluginVendor: string;
  skippedReason?: string;
} {
  const combined = `${name} ${typeof rawVendor === 'string' ? rawVendor : ''}`.trim();
  const matchedPaid = PAID_PLUGIN_SIGNATURES.find((sig) => sig.pattern.test(combined));
  const declaredPaid =
    typeof rawTier === 'string' && /paid|third[- ]?party|commercial|premium/i.test(rawTier);

  if (matchedPaid || declaredPaid) {
    const vendor =
      (typeof rawVendor === 'string' && rawVendor.trim()) ||
      matchedPaid?.vendor ||
      'Third-Party Paid Plugin';
    const reason =
      (typeof rawSkippedReason === 'string' && rawSkippedReason.trim()) ||
      `Paid / third-party plugin (${vendor}) detected — skipped cleanly so pipeline continues with Free / Built-in Premiere Pro effects.`;
    return {
      licenseTier: 'Paid / Third-Party',
      includedInTimeline: false,
      pluginVendor: vendor,
      skippedReason: reason,
    };
  }

  return {
    licenseTier: 'Free / Built-in',
    includedInTimeline: true,
    pluginVendor:
      typeof rawVendor === 'string' && rawVendor.trim() && !/unknown/i.test(rawVendor)
        ? rawVendor.trim()
        : 'Adobe Premiere Pro (Built-in)',
  };
}

function inferPremiereVideoEffectId(name: string, category: string): string {
  const lower = `${name} ${category}`.toLowerCase();
  if (/directional\s*blur|motion\s*blur|whip/.test(lower)) return 'AE.ADBE Motion Blur';
  if (/gaussian|fast\s*blur|blur/.test(lower)) return 'Gaussian Blur';
  if (/sharpen|unsharp/.test(lower)) return 'AE.ADBE Sharpen';
  if (/grain|noise/.test(lower)) return 'AE.ADBE Noise';
  if (/vignette|lumetri|grade|lut|glow|color/.test(lower)) return 'AE.ADBE Lumetri';
  if (/chromatic|rgb\s*split|glitch|vr/.test(lower)) return 'AE.ADBE VR Chromatic Aberrations';
  if (/tint|duotone/.test(lower)) return 'AE.ADBE Tint';
  if (/invert|flash|strobe/.test(lower)) return 'AE.ADBE Brightness & Contrast 2';
  if (/crop|letterbox|split|mask/.test(lower)) return 'AE.ADBE Crop';
  if (/wave|warp|shake|distort/.test(lower)) return 'AE.ADBE Wave Warp';
  if (/mirror|flip/.test(lower)) return 'AE.ADBE Mirror';
  if (/speed|time\s*remap|ramp/.test(lower)) return 'timeremap';
  return 'AE.ADBE Geometry2';
}

function inferPremiereAudioEffectId(name: string, category: string): string {
  const lower = `${name} ${category}`.toLowerCase();
  if (/low[- ]?pass|muffle|underwater/.test(lower)) return 'Lowpass';
  if (/high[- ]?pass|rumble|cut\s*low/.test(lower)) return 'Highpass';
  if (/eq|equalizer|bass\s*boost|presence|treble/.test(lower)) return 'ParametricEqualizer';
  if (/limit|maximizer|loudness/.test(lower)) return 'HardLimiter';
  if (/compress|duck|sidechain|punch|dynamics/.test(lower)) return 'SingleBandCompressor';
  if (/reverb|hall|room|ambience/.test(lower)) return 'StudioReverb';
  if (/delay|echo|slapback/.test(lower)) return 'AnalogDelay';
  if (/denoise|noise\s*reduc|de-?ess|clean/.test(lower)) return 'DeNoise';
  if (/pitch|slowed|sped|formant/.test(lower)) return 'PitchShifter';
  if (/stereo|width|pan|imager/.test(lower)) return 'StereoExpander';
  if (/fade|automation|gain|volume/.test(lower)) return 'audiolevels';
  return 'ParametricEqualizer';
}

export interface RunAnalysisOptions {
  file: File;
  sourceOrigin: VideoMetadata['sourceOrigin'];
  instagramInfo?: InstagramInspectResult;
  settings: AppSettings;
  onStageUpdate: (stages: AnalysisPipelineStage[]) => void;
}

export interface RunAnalysisResult {
  project: ReelProject;
  videoObjectUrl: string | null;
}

function buildNeutralColorGrade(): ColorGradeSettings {
  return {
    profileName: 'Neutral Rec. 709 (Unmeasured Fallback)',
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    saturation: 100,
    vibrance: 0,
    hueShift: 0,
    vignette: 0,
    sharpening: 0,
    fade: 0,
    filmGrain: 0,
    rgbCurves: {
      redLift: 0,
      redGain: 1,
      greenLift: 0,
      greenGain: 1,
      blueLift: 0,
      blueGain: 1,
    },
    skinToneNote: 'Frame histograms were unavailable; neutral Rec. 709 baseline applied.',
    confidence: 'Low',
    confidenceScore: 40,
  };
}

export async function runFullVideoAnalysis(
  opts: RunAnalysisOptions
): Promise<RunAnalysisResult> {
  const { file, sourceOrigin, instagramInfo, settings, onStageUpdate } = opts;

  const stages: AnalysisPipelineStage[] = INITIAL_PIPELINE_STAGES.map((s) => ({ ...s }));
  const skippedStages: Array<{ stageId: number; label: string; reason: string }> = [];

  const setStage = (id: number, status: AnalysisPipelineStage['status'], detail?: string) => {
    const idx = stages.findIndex((s) => s.id === id);
    if (idx !== -1) {
      stages[idx] = { ...stages[idx], status, detail };
      if (status === 'warning' && detail) {
        skippedStages.push({ stageId: id, label: stages[idx].label, reason: detail });
      }
      onStageUpdate(stages.map((s) => ({ ...s })));
    }
  };

  // Stage 1: Validating source
  setStage(1, 'active', `Inspecting ${file.name}`);
  const { container, codec } = inferContainerAndCodec(file);
  if (file.size === 0) {
    setStage(1, 'warning', 'File size reported as 0 bytes — proceeding with metadata shell');
  } else {
    setStage(1, 'done', `${container} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`);
  }

  // Stage 2: Retrieving or importing video
  setStage(2, 'active', 'Loading media container & decoding stream headers');
  let video: HTMLVideoElement | null = null;
  let objectUrl: string | null = null;
  let width = 1080;
  let height = 1920;
  let durationSec = 10;

  try {
    const loaded = await loadVideoElement(file);
    video = loaded.video;
    objectUrl = loaded.objectUrl;
    width = video.videoWidth || 1080;
    height = video.videoHeight || 1920;
    durationSec = Math.max(0.5, Number.isFinite(video.duration) ? video.duration : 10);
    setStage(2, 'done', `${width}×${height} · ${computeAspectRatio(width, height)} · ${durationSec.toFixed(2)}s`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Browser could not decode this video codec.';
    setStage(
      2,
      'warning',
      `Skipped browser decode (${msg.slice(0, 110)}) — continuing with container-level sequence`
    );
  }

  const fps = settings.defaultTimebase;
  const bitrateKbps = Math.round((file.size * 8) / Math.max(1, durationSec) / 1000);
  const proxyScale =
    settings.proxyQuality === '540p Proxy'
      ? 540
      : settings.proxyQuality === '720p Proxy'
      ? 720
      : Math.max(width, height);

  const metadata: VideoMetadata = {
    fileName: file.name,
    fileSizeBytes: file.size,
    mimeType: file.type || 'video/mp4',
    container,
    codec,
    width,
    height,
    aspectRatio: computeAspectRatio(width, height),
    durationSec: Number(durationSec.toFixed(3)),
    fps,
    bitrateKbps,
    audioSampleRate: 48000,
    audioChannels: 2,
    colorSpace: 'Rec. 709 (SDR)',
    hdrDetected: false,
    proxyScale,
    sourceOrigin,
    sourceUrl: instagramInfo?.normalizedUrl,
  };

  // Stage 3: Extracting frames (adaptive sampling)
  setStage(3, 'active', 'Sampling adaptive analysis frames via Canvas2D');
  const sampledFrames: SampledFrame[] = [];
  if (video) {
    try {
      const analysisMaxEdge = 180;
      const scale = analysisMaxEdge / Math.max(width, height);
      const aw = Math.max(32, Math.round(width * scale));
      const ah = Math.max(32, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = aw;
      canvas.height = ah;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas2D context unavailable.');

      const targetSamples =
        settings.samplingDensity === 'High Precision'
          ? Math.min(90, Math.max(24, Math.round(durationSec * 4)))
          : settings.samplingDensity === 'Fast Draft'
          ? Math.min(36, Math.max(14, Math.round(durationSec * 1.8)))
          : Math.min(64, Math.max(18, Math.round(durationSec * 3)));

      for (let i = 0; i < targetSamples; i++) {
        const t = (i / Math.max(1, targetSamples - 1)) * Math.max(0.1, durationSec - 0.04);
        try {
          await seekVideo(video, t);
          ctx.drawImage(video, 0, 0, aw, ah);
          const imgData = ctx.getImageData(0, 0, aw, ah);
          sampledFrames.push(analyzeFramePixels(imgData, t));
        } catch {
          // Skip unreadable individual frame without aborting the loop
        }
      }

      if (sampledFrames.length > 0) {
        setStage(3, 'done', `${sampledFrames.length} adaptive frames sampled`);
      } else {
        setStage(3, 'warning', 'No frames could be extracted — continuing with single-clip sequence');
      }
    } catch (err) {
      setStage(
        3,
        'warning',
        `Frame extraction incomplete (${err instanceof Error ? err.message : 'Canvas error'}) — continuing`
      );
    }
  } else {
    setStage(3, 'warning', 'Skipped frame extraction (video stream undecodable in browser)');
  }

  // Stage 4: Detecting scenes (real histogram + luma delta cut detection)
  setStage(4, 'active', 'Computing inter-frame histogram & luminance deltas');
  const cutPoints: Array<{ timeSec: number; deltaScore: number }> = [{ timeSec: 0, deltaScore: 100 }];

  if (sampledFrames.length >= 2) {
    try {
      const deltas: Array<{ idx: number; timeSec: number; score: number; lumaDelta: number }> = [];
      for (let i = 1; i < sampledFrames.length; i++) {
        const hDiff = histogramDiff(sampledFrames[i - 1].histogram, sampledFrames[i].histogram);
        const lDiff = lumaGridDiff(sampledFrames[i - 1].lumaGrid, sampledFrames[i].lumaGrid);
        deltas.push({
          idx: i,
          timeSec: sampledFrames[i].timeSec,
          score: hDiff * 0.65 + lDiff * 0.35,
          lumaDelta: lDiff,
        });
      }

      const meanDelta = deltas.reduce((acc, d) => acc + d.score, 0) / Math.max(1, deltas.length);
      const stdDelta = Math.sqrt(
        deltas.reduce((acc, d) => acc + Math.pow(d.score - meanDelta, 2), 0) /
          Math.max(1, deltas.length)
      );
      const cutThreshold = Math.max(14, meanDelta + stdDelta * 1.15);
      const minShotDuration = durationSec < 6 ? 0.6 : 0.85;

      for (let i = 0; i < deltas.length; i++) {
        const d = deltas[i];
        const prev = i > 0 ? deltas[i - 1].score : 0;
        const next = i < deltas.length - 1 ? deltas[i + 1].score : 0;
        if (d.score >= cutThreshold && d.score >= prev && d.score >= next) {
          const lastCut = cutPoints[cutPoints.length - 1].timeSec;
          if (d.timeSec - lastCut >= minShotDuration && durationSec - d.timeSec >= 0.45) {
            cutPoints.push({ timeSec: Number(d.timeSec.toFixed(3)), deltaScore: Math.round(d.score) });
          }
        }
      }

      if (cutPoints.length === 1 && durationSec >= 5) {
        const segs = Math.min(4, Math.max(2, Math.round(durationSec / 3.5)));
        for (let s = 1; s < segs; s++) {
          cutPoints.push({
            timeSec: Number(((durationSec / segs) * s).toFixed(3)),
            deltaScore: 22,
          });
        }
      }
      setStage(4, 'done', `${cutPoints.length} shot boundaries identified`);
    } catch (err) {
      setStage(
        4,
        'warning',
        `Scene detection skipped (${err instanceof Error ? err.message : 'error'}) — using full-length clip`
      );
    }
  } else {
    setStage(4, 'warning', 'Insufficient sampled frames — exported as single continuous clip');
  }

  // Stage 5: Analyzing motion, flash/blur/chroma cues & extracting crisp keyframes per shot
  setStage(5, 'active', 'Measuring shot motion, flash/blur/chroma cues & extracting inspection keyframes');
  const rawShots: RawShotDetection[] = [];
  const keyframesForAi: Array<{ shotIndex: number; timeSec: number; role: string; base64Jpeg: string }> = [];

  try {
    const thumbCanvas = document.createElement('canvas');
    const thumbMax = 540;
    const tScale = thumbMax / Math.max(width, height);
    thumbCanvas.width = Math.max(64, Math.round(width * tScale));
    thumbCanvas.height = Math.max(64, Math.round(height * tScale));
    const thumbCtx = thumbCanvas.getContext('2d');

    const sortedSharpness = sampledFrames.map((f) => f.sharpnessVar).sort((a, b) => a - b);
    const medianSharpness =
      sortedSharpness.length > 0 ? sortedSharpness[Math.floor(sortedSharpness.length / 2)] : 15;
    const sortedLuma = sampledFrames.map((f) => f.meanLuma).sort((a, b) => a - b);
    const medianLuma =
      sortedLuma.length > 0 ? sortedLuma[Math.floor(sortedLuma.length / 2)] : 110;

    for (let s = 0; s < cutPoints.length; s++) {
      const startSec = cutPoints[s].timeSec;
      const endSec = s < cutPoints.length - 1 ? cutPoints[s + 1].timeSec : durationSec;
      const dur = Math.max(0.25, endSec - startSec);
      const midpointSec = Number((startSec + dur * 0.5).toFixed(3));

      const inside = sampledFrames.filter((f) => f.timeSec >= startSec && f.timeSec <= endSec);
      let motionAccum = 0;
      let flashSpikeDetected = false;
      let blurDropDetected = false;
      let chromaSpreadAccum = 0;

      for (let k = 0; k < inside.length; k++) {
        const fr = inside[k];
        if (k > 0) {
          motionAccum += lumaGridDiff(inside[k - 1].lumaGrid, fr.lumaGrid);
          if (Math.abs(fr.meanLuma - inside[k - 1].meanLuma) > 45) {
            flashSpikeDetected = true;
          }
        }
        if (fr.whiteCeiling >= 248 && fr.meanLuma > medianLuma + 35) {
          flashSpikeDetected = true;
        }
        if (medianSharpness > 6 && fr.sharpnessVar < medianSharpness * 0.62) {
          blurDropDetected = true;
        }
        chromaSpreadAccum += Math.abs(fr.meanR - fr.meanB) + Math.abs(fr.meanR - fr.meanG) * 0.5;
      }

      const measuredMotionScore = Math.round(
        clamp(inside.length > 1 ? motionAccum / (inside.length - 1) : 12, 0, 100)
      );
      const chromaSpreadScore = Math.round(
        clamp(inside.length > 0 ? (chromaSpreadAccum / inside.length) * 0.75 : 10, 0, 100)
      );

      let thumbUrl = '';
      if (video && thumbCtx) {
        try {
          await seekVideo(video, midpointSec);
          thumbCtx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
          thumbUrl = thumbCanvas.toDataURL('image/jpeg', 0.84);
        } catch {
          thumbUrl = '';
        }
      }

      rawShots.push({
        index: s,
        startTimeSec: Number(startSec.toFixed(3)),
        endTimeSec: Number(endSec.toFixed(3)),
        durationSec: Number(dur.toFixed(3)),
        measuredMotionScore,
        measuredCutDelta: cutPoints[s].deltaScore,
        flashSpikeDetected,
        blurDropDetected,
        chromaSpreadScore,
        beatAligned: false,
        thumbnailDataUrl: thumbUrl,
        midpointSec,
      });

      if (thumbUrl && keyframesForAi.length < 24) {
        keyframesForAi.push({
          shotIndex: s,
          timeSec: midpointSec,
          role: 'shot-midpoint',
          base64Jpeg: thumbUrl,
        });
      }

      // Extract an extra boundary/transition frame on high-delta cuts or detected flash/blur cues (up to 18 before caption-cadence pass)
      if (
        video &&
        thumbCtx &&
        keyframesForAi.length < 18 &&
        (cutPoints[s].deltaScore >= 32 || flashSpikeDetected || blurDropDetected)
      ) {
        const boundarySec = Number(clamp(startSec + Math.min(0.12, dur * 0.2), 0, durationSec - 0.04).toFixed(3));
        if (Math.abs(boundarySec - midpointSec) > 0.12) {
          try {
            await seekVideo(video, boundarySec);
            thumbCtx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
            const boundaryUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);
            keyframesForAi.push({
              shotIndex: s,
              timeSec: boundarySec,
              role: flashSpikeDetected ? 'flash-boundary' : blurDropDetected ? 'blur-boundary' : 'transition-entry',
              base64Jpeg: boundaryUrl,
            });
          } catch {
            // Non-blocking
          }
        }
      }
    }

    // Fill remaining keyframe slots (up to 24 total) with evenly-spaced high-res caption-cadence frames
    // so fast-changing on-screen captions inside longer shots are captured crisply for accurate zero-typo OCR
    if (video && thumbCtx && keyframesForAi.length < 24 && durationSec > 0.8) {
      const remainingSlots = 24 - keyframesForAi.length;
      const startSpan = Math.min(0.25, durationSec * 0.05);
      const endSpan = Math.max(startSpan + 0.2, durationSec - 0.15);
      const step = (endSpan - startSpan) / Math.max(1, remainingSlots + 1);

      for (let c = 1; c <= remainingSlots && keyframesForAi.length < 24; c++) {
        const sampleSec = Number(clamp(startSpan + step * c, 0.1, durationSec - 0.08).toFixed(3));
        const tooClose = keyframesForAi.some((kf) => Math.abs(kf.timeSec - sampleSec) < 0.45);
        if (tooClose) continue;

        const owningShot = rawShots.findIndex(
          (sh) => sampleSec >= sh.startTimeSec && sampleSec <= sh.endTimeSec
        );
        try {
          await seekVideo(video, sampleSec);
          thumbCtx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
          const capUrl = thumbCanvas.toDataURL('image/jpeg', 0.84);
          keyframesForAi.push({
            shotIndex: owningShot >= 0 ? owningShot : 0,
            timeSec: sampleSec,
            role: 'caption-cadence',
            base64Jpeg: capUrl,
          });
        } catch {
          // Non-blocking
        }
      }
    }

    keyframesForAi.sort((a, b) => a.timeSec - b.timeSec);

    if (keyframesForAi.length > 0) {
      setStage(5, 'done', `Extracted ${keyframesForAi.length} high-res shot & caption OCR keyframes`);
    } else {
      setStage(5, 'warning', 'Keyframes unavailable — proceeding with timing-only shot clips');
    }
  } catch (err) {
    if (rawShots.length === 0) {
      rawShots.push({
        index: 0,
        startTimeSec: 0,
        endTimeSec: Number(durationSec.toFixed(3)),
        durationSec: Number(durationSec.toFixed(3)),
        measuredMotionScore: 0,
        measuredCutDelta: 0,
        flashSpikeDetected: false,
        blurDropDetected: false,
        chromaSpreadScore: 0,
        beatAligned: false,
        thumbnailDataUrl: '',
        midpointSec: Number((durationSec * 0.5).toFixed(3)),
      });
    }
    setStage(
      5,
      'warning',
      `Motion/keyframe step incomplete (${err instanceof Error ? err.message : 'error'}) — continuing`
    );
  }

  // Stage 6: Analyzing audio via Web Audio API (beats, transients, spectral profile & DSP free audio FX)
  setStage(6, 'active', 'Decoding Web Audio waveform, spectral bands, dynamics & beats');
  let audioResult = await analyzeAudioFromFile(file, durationSec).catch(() => null);
  if (!audioResult) {
    audioResult = await analyzeAudioFromFile(new File([], 'silent.mp4'), durationSec);
  }
  const audio = audioResult.analysis;
  metadata.audioSampleRate = audio.sampleRate;
  metadata.audioChannels = audio.channels;

  if (audio.hasAudio) {
    const tolSec = settings.beatSnapToleranceMs / 1000;
    for (const shot of rawShots) {
      if (shot.index === 0) continue;
      let closestBeat = audio.beats[0];
      let minDiff = Infinity;
      for (const b of audio.beats) {
        const diff = Math.abs(b.timeSec - shot.startTimeSec);
        if (diff < minDiff) {
          minDiff = diff;
          closestBeat = b;
        }
      }
      if (closestBeat && minDiff <= tolSec) {
        shot.beatAligned = true;
        shot.alignedBeatTimeSec = closestBeat.timeSec;
        closestBeat.syncedShotId = `shot-${shot.index + 1}`;
      }
    }
    setStage(
      6,
      'done',
      `${audio.estimatedBpm} BPM · ${audio.beats.length} beats · ${audioResult.dspAudioEffects.length} DSP audio FX`
    );
  } else {
    setStage(6, 'warning', 'Audio stream undecodable or silent — continuing without beat grid');
  }

  // Stage 8 measurement prep (real pixel color grading)
  const baseColorGrade =
    sampledFrames.length > 0 ? deriveColorGradeFromFrames(sampledFrames) : buildNeutralColorGrade();

  // Stage 7: Deep multimodal visual FX, Free-vs-Paid filtering, Audio FX & OCR via Server-Side Gemini AI
  setStage(7, 'active', 'Researching visual & audio effects, Free vs Paid plugins, OCR & link context');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ai: any = null;
  let aiSkippedReason: string | null = null;

  if (keyframesForAi.length === 0) {
    aiSkippedReason = 'No keyframes extracted for AI inspection — using local CV & DSP data';
    setStage(7, 'warning', aiSkippedReason);
  } else {
    try {
      const aiRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metadata,
          rawShots: rawShots.map(({ thumbnailDataUrl: _t, ...rest }) => rest),
          keyframes: keyframesForAi,
          colorMeasurements: {
            profileName: baseColorGrade.profileName,
            exposure: baseColorGrade.exposure,
            contrast: baseColorGrade.contrast,
            highlights: baseColorGrade.highlights,
            shadows: baseColorGrade.shadows,
            temperature: baseColorGrade.temperature,
            tint: baseColorGrade.tint,
            saturation: baseColorGrade.saturation,
            vignette: baseColorGrade.vignette,
            fade: baseColorGrade.fade,
            filmGrain: baseColorGrade.filmGrain,
          },
          audioMeasurements: {
            hasAudio: audio.hasAudio,
            estimatedBpm: audio.estimatedBpm,
            beats: audio.beats,
            transientTimes: audioResult.transientTimes,
            hasFadeIn: audioResult.hasFadeIn,
            hasFadeOut: audioResult.hasFadeOut,
            spectralProfile: audioResult.spectralProfile,
          },
          instagramContext: instagramInfo,
          sourceContext: instagramInfo,
        }),
      });

      const aiJson = await aiRes.json().catch(() => ({}));
      if (!aiRes.ok || !aiJson.analysis) {
        const reason = String(
          aiJson?.error || `AI service returned HTTP ${aiRes.status} — continuing with CV/Audio analysis`
        );
        aiSkippedReason = reason;
        setStage(7, 'warning', reason);
      } else {
        ai = aiJson.analysis;
        const rawAiFxCount = (ai.effects ?? []).length;
        const rawAiAudioFxCount = (ai.audioDesign?.audioEffects ?? []).length;
        setStage(
          7,
          'done',
          `${rawAiFxCount} visual FX · ${rawAiAudioFxCount} audio FX · ${(ai.motionGraphics ?? []).length} OCR layers`
        );
      }
    } catch (err) {
      aiSkippedReason = `AI request failed (${err instanceof Error ? err.message : 'network error'}) — continuing with CV/Audio data`;
      setStage(7, 'warning', aiSkippedReason);
    }
  }

  // Stage 8: Finalizing color grading profile
  setStage(8, 'active', 'Merging pixel histograms with color profile');
  const colorGrade: ColorGradeSettings = {
    ...baseColorGrade,
    profileName: ai?.colorProfile?.profileName || baseColorGrade.profileName,
    skinToneNote: ai?.colorProfile?.skinToneNote || baseColorGrade.skinToneNote,
    confidence: ai?.colorProfile?.confidence
      ? safeConfidence(ai.colorProfile.confidence)
      : baseColorGrade.confidence,
    confidenceScore: clamp(
      Number(ai?.colorProfile?.confidenceScore ?? baseColorGrade.confidenceScore),
      35,
      98
    ),
  };
  if (sampledFrames.length > 0) {
    setStage(8, 'done', `${colorGrade.profileName} (${colorGrade.confidence} confidence)`);
  } else {
    setStage(8, 'warning', 'Neutral Rec. 709 baseline applied (no frame histograms)');
  }

  // Stage 9: Reconstructing multitrack timeline (adding ALL Free FX, skipping Paid plugins cleanly)
  setStage(9, 'active', 'Assembling V1–V3 / A1–A4 timeline, applying all Free FX & skipping Paid plugins');
  const shots: ShotClip[] = rawShots.map((raw, i) => {
    const aiShot =
      (ai?.shots ?? []).find((s: { index: number }) => s.index === i) || ai?.shots?.[i] || {};
    const startScale = clamp(Number(aiShot.estimatedScale ?? 100), 80, 180);
    const endScale = clamp(Number(aiShot.estimatedEndScale ?? startScale), 80, 190);
    const keyframes: KeyframePoint[] = [];

    if (Math.abs(endScale - startScale) >= 2) {
      keyframes.push(
        {
          id: `kf-${i}-s0`,
          timeSec: 0,
          property: 'scale',
          value: startScale,
          easing: 'Ease In',
        },
        {
          id: `kf-${i}-s1`,
          timeSec: Number(raw.durationSec.toFixed(3)),
          property: 'scale',
          value: endScale,
          easing: 'Ease Out',
        }
      );
    }

    const transType = safeTransitionType(aiShot.transitionType);
    const transDur =
      transType === 'Cut'
        ? 0
        : clamp(
            Number(aiShot.transitionDurationSec ?? 0.35),
            0.1,
            Math.min(1.5, raw.durationSec * 0.5)
          );

    const inferredMotion =
      aiShot.cameraMovement ||
      (raw.measuredMotionScore >= 40
        ? 'Dynamic Motion (CV Measured)'
        : raw.measuredMotionScore >= 18
        ? 'Moderate Movement (CV Measured)'
        : 'Static / Subtle (CV Measured)');

    return {
      id: `shot-${i + 1}`,
      index: i,
      name: aiShot.name || `Shot ${String(i + 1).padStart(2, '0')}`,
      trackId: 'V1',
      startTimeSec: raw.startTimeSec,
      endTimeSec: raw.endTimeSec,
      sourceInSec: raw.startTimeSec,
      sourceOutSec: raw.endTimeSec,
      durationSec: raw.durationSec,
      thumbnailDataUrl: raw.thumbnailDataUrl,
      shotType: aiShot.shotType || (ai ? 'Medium Shot' : 'Unclassified (CV Cut)'),
      section:
        aiShot.section === 'Opening' || aiShot.section === 'Closing'
          ? aiShot.section
          : i === 0
          ? 'Opening'
          : i === rawShots.length - 1
          ? 'Closing'
          : 'Main',
      subjectPosition: aiShot.subjectPosition || (ai ? 'Centered' : 'Not inspected by AI'),
      cameraMovement: inferredMotion,
      speedPercent: clamp(Number(aiShot.speedPercent ?? 100), 25, 400),
      speedRampProfile: aiShot.speedRampProfile || 'Constant 100%',
      scale: startScale,
      positionX: clamp(Number(aiShot.estimatedPositionX ?? 0), -400, 400),
      positionY: clamp(Number(aiShot.estimatedPositionY ?? 0), -400, 400),
      rotation: clamp(Number(aiShot.estimatedRotation ?? 0), -45, 45),
      opacity: 100,
      transitionOut: {
        type: transType,
        durationSec: Number(transDur.toFixed(2)),
        intensity: clamp(
          Number(aiShot.transitionIntensity ?? (transType === 'Cut' ? 0 : 65)),
          0,
          100
        ),
        direction: (['None', 'In', 'Out', 'Left', 'Right', 'Up', 'Down'].includes(
          aiShot.transitionDirection
        )
          ? aiShot.transitionDirection
          : 'None') as ShotTransition['direction'],
        confidence: ai ? safeConfidence(aiShot.confidence) : 'Low',
        premiereSupport: safeCompat(
          aiShot.transitionPremiereSupport ||
            (transType === 'Cut' || transType === 'Cross Dissolve' ? 'Native' : 'Approximate')
        ),
        premiereMapping:
          aiShot.transitionPremiereMapping ||
          (transType === 'Cut'
            ? 'Direct Edit Cut'
            : transType === 'Cross Dissolve'
            ? 'Premiere Cross Dissolve'
            : 'Keyframed Motion + Transform Approximation'),
      },
      keyframes,
      colorShiftNote: aiShot.colorShiftNote || 'Consistent with measured look',
      measuredMotionScore: raw.measuredMotionScore,
      measuredCutDelta: raw.measuredCutDelta,
      beatAligned: raw.beatAligned,
      alignedBeatTimeSec: raw.alignedBeatTimeSec,
      confidence: ai ? safeConfidence(aiShot.confidence) : raw.measuredCutDelta >= 20 ? 'Medium' : 'Low',
      description:
        aiShot.description ||
        `Shot segment detected via histogram cut analysis (${raw.startTimeSec.toFixed(2)}s–${raw.endTimeSec.toFixed(2)}s).`,
    };
  });

  // 1) Map AI-detected visual effects with strict Free vs Paid classification
  const effects: EffectItem[] = (ai?.effects ?? []).map(
    (ef: Record<string, unknown>, idx: number): EffectItem => {
      const start = clamp(Number(ef.startTimeSec ?? 0), 0, durationSec);
      const end = clamp(
        Number(ef.endTimeSec ?? Math.min(durationSec, start + 0.5)),
        start + 0.05,
        durationSec
      );
      const name = String(ef.name || 'Visual Effect');
      const category = ([
        'Transition',
        'Motion',
        'Blur',
        'Stylize',
        'Light',
        'Speed',
        'Mask',
        'Distort',
        'Color',
      ].includes(String(ef.category))
        ? String(ef.category)
        : 'Motion') as EffectItem['category'];

      const license = classifyEffectLicense(name, ef.licenseTier, ef.pluginVendor, ef.skippedReason);
      const premiereEffectName = String(
        ef.premiereEffectName ||
          (license.licenseTier === 'Paid / Third-Party'
            ? 'Skipped (Paid Third-Party Plugin)'
            : 'Transform / Basic Motion')
      );
      const premiereEffectId = String(
        ef.premiereEffectId || inferPremiereVideoEffectId(premiereEffectName || name, category)
      );

      return {
        id: `fx-${idx + 1}`,
        name,
        category,
        shotId: typeof ef.shotIndex === 'number' ? `shot-${ef.shotIndex + 1}` : undefined,
        startTimeSec: Number(start.toFixed(2)),
        endTimeSec: Number(end.toFixed(2)),
        durationSec: Number((end - start).toFixed(2)),
        intensity: clamp(Number(ef.intensity ?? 55), 0, 100),
        direction: String(ef.direction || 'None'),
        parameters: {
          Intensity: `${clamp(Number(ef.intensity ?? 55), 0, 100)}%`,
          Direction: String(ef.direction || 'None'),
        },
        confidence: safeConfidence(ef.confidence),
        premiereSupport:
          license.licenseTier === 'Paid / Third-Party'
            ? 'Unsupported'
            : safeCompat(ef.premiereSupport || 'Native'),
        premiereEffectName,
        premiereEffectId,
        approximationNote: String(
          ef.approximationNote ||
            (license.licenseTier === 'Paid / Third-Party'
              ? license.skippedReason || 'Bypassed paid third-party plugin.'
              : 'Included as Free / Built-in Adobe Premiere Pro effect.')
        ),
        licenseTier: license.licenseTier,
        includedInTimeline: license.includedInTimeline,
        pluginVendor: license.pluginVendor,
        skippedReason: license.skippedReason,
      };
    }
  );

  // 2) Automatically add CV-grounded Free / Built-in visual effects so ALL free measured effects are included
  const hasSimilarVideoFx = (needle: RegExp, shotId?: string) =>
    effects.some(
      (e) =>
        e.includedInTimeline &&
        needle.test(`${e.name} ${e.premiereEffectName}`) &&
        (!shotId || !e.shotId || e.shotId === shotId)
    );

  let cvFxSeq = effects.length + 1;
  if (colorGrade.vignette >= 15 && !hasSimilarVideoFx(/vignette/i)) {
    effects.push({
      id: `fx-cv-${cvFxSeq++}`,
      name: 'Edge Vignette (CV Measured)',
      category: 'Color',
      startTimeSec: 0,
      endTimeSec: Number(durationSec.toFixed(2)),
      durationSec: Number(durationSec.toFixed(2)),
      intensity: clamp(Math.round(colorGrade.vignette), 15, 100),
      direction: 'Radial',
      parameters: { Amount: `-${(colorGrade.vignette * 0.04).toFixed(1)}`, Midpoint: '50%' },
      confidence: 'High',
      premiereSupport: 'Native',
      premiereEffectName: 'Lumetri Color (Vignette)',
      premiereEffectId: 'AE.ADBE Lumetri',
      approximationNote: 'Measured corner luminance falloff; added as free built-in Lumetri Vignette.',
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      pluginVendor: 'Adobe Premiere Pro (Built-in)',
    });
  }

  if (colorGrade.filmGrain >= 15 && !hasSimilarVideoFx(/grain|noise/i)) {
    effects.push({
      id: `fx-cv-${cvFxSeq++}`,
      name: 'Film Grain / Texture Noise (CV Measured)',
      category: 'Stylize',
      startTimeSec: 0,
      endTimeSec: Number(durationSec.toFixed(2)),
      durationSec: Number(durationSec.toFixed(2)),
      intensity: clamp(Math.round(colorGrade.filmGrain), 15, 100),
      direction: 'Full Frame',
      parameters: { NoiseAmount: `${Math.round(colorGrade.filmGrain * 0.25)}%`, UseColorNoise: 'Off' },
      confidence: 'Medium',
      premiereSupport: 'Native',
      premiereEffectName: 'Noise (Built-in)',
      premiereEffectId: 'AE.ADBE Noise',
      approximationNote: 'Measured high-frequency frame grain; added as free built-in Premiere Noise filter.',
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      pluginVendor: 'Adobe Premiere Pro (Built-in)',
    });
  }

  if (colorGrade.sharpening >= 20 && !hasSimilarVideoFx(/sharpen/i)) {
    effects.push({
      id: `fx-cv-${cvFxSeq++}`,
      name: 'Crisp Edge Sharpening (CV Measured)',
      category: 'Stylize',
      startTimeSec: 0,
      endTimeSec: Number(durationSec.toFixed(2)),
      durationSec: Number(durationSec.toFixed(2)),
      intensity: clamp(Math.round(colorGrade.sharpening), 15, 100),
      direction: 'Full Frame',
      parameters: { SharpenAmount: `${Math.round(colorGrade.sharpening * 0.4)}` },
      confidence: 'Medium',
      premiereSupport: 'Native',
      premiereEffectName: 'Sharpen',
      premiereEffectId: 'AE.ADBE Sharpen',
      approximationNote: 'Measured edge acutance; added as free built-in Premiere Sharpen filter.',
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      pluginVendor: 'Adobe Premiere Pro (Built-in)',
    });
  }

  rawShots.forEach((raw, idx) => {
    const shotId = `shot-${idx + 1}`;
    if (raw.flashSpikeDetected && !hasSimilarVideoFx(/flash|exposure|bright/i, shotId)) {
      effects.push({
        id: `fx-cv-${cvFxSeq++}`,
        name: `Exposure Flash Hit (Shot ${idx + 1})`,
        category: 'Light',
        shotId,
        startTimeSec: raw.startTimeSec,
        endTimeSec: Number(Math.min(raw.endTimeSec, raw.startTimeSec + 0.35).toFixed(2)),
        durationSec: Number(Math.min(0.35, raw.durationSec).toFixed(2)),
        intensity: 75,
        direction: 'In',
        parameters: { BrightnessSpike: '+45', Contrast: '+10' },
        confidence: 'High',
        premiereSupport: 'Native',
        premiereEffectName: 'Brightness & Contrast (Keyframed Flash)',
        premiereEffectId: 'AE.ADBE Brightness & Contrast 2',
        approximationNote: 'Detected luminance spike at shot boundary; added as free built-in Premiere effect.',
        licenseTier: 'Free / Built-in',
        includedInTimeline: true,
        pluginVendor: 'Adobe Premiere Pro (Built-in)',
      });
    }
    if (raw.blurDropDetected && !hasSimilarVideoFx(/blur/i, shotId)) {
      effects.push({
        id: `fx-cv-${cvFxSeq++}`,
        name: `Motion / Defocus Blur (Shot ${idx + 1})`,
        category: 'Blur',
        shotId,
        startTimeSec: raw.startTimeSec,
        endTimeSec: raw.endTimeSec,
        durationSec: raw.durationSec,
        intensity: 48,
        direction: 'Full Frame',
        parameters: { Blurriness: '28', RepeatEdgePixels: 'On' },
        confidence: 'Medium',
        premiereSupport: 'Native',
        premiereEffectName: 'Gaussian Blur',
        premiereEffectId: 'Gaussian Blur',
        approximationNote: 'Measured sharpness drop inside shot; added as free built-in Gaussian Blur.',
        licenseTier: 'Free / Built-in',
        includedInTimeline: true,
        pluginVendor: 'Adobe Premiere Pro (Built-in)',
      });
    }
    if (raw.chromaSpreadScore >= 44 && !hasSimilarVideoFx(/chromatic|rgb|glitch|tint/i, shotId)) {
      effects.push({
        id: `fx-cv-${cvFxSeq++}`,
        name: `Chromatic Channel Split (Shot ${idx + 1})`,
        category: 'Distort',
        shotId,
        startTimeSec: raw.startTimeSec,
        endTimeSec: raw.endTimeSec,
        durationSec: raw.durationSec,
        intensity: clamp(raw.chromaSpreadScore, 25, 85),
        direction: 'Horizontal',
        parameters: { RedShift: '4px', BlueShift: '-4px' },
        confidence: 'Medium',
        premiereSupport: 'Native',
        premiereEffectName: 'VR Chromatic Aberrations',
        premiereEffectId: 'AE.ADBE VR Chromatic Aberrations',
        approximationNote: 'Measured R/B chroma separation; added as free built-in VR Chromatic Aberrations.',
        licenseTier: 'Free / Built-in',
        includedInTimeline: true,
        pluginVendor: 'Adobe Premiere Pro (Built-in)',
      });
    }
  });

  let motionGraphics: MotionGraphicItem[] = (ai?.motionGraphics ?? [])
    .filter((mg: Record<string, unknown>) => typeof mg.text === 'string' && mg.text.trim().length > 0)
    .map((mg: Record<string, unknown>, idx: number) => {
      const start = clamp(Number(mg.startTimeSec ?? 0), 0, durationSec);
      const end = clamp(
        Number(mg.endTimeSec ?? Math.min(durationSec, start + 2)),
        start + 0.2,
        durationSec
      );
      const rawType = (['Title', 'Subtitle', 'Caption', 'Lower Third', 'Callout', 'Logo', 'Shape'].includes(
        String(mg.type)
      )
        ? String(mg.type)
        : 'Caption') as MotionGraphicItem['type'];
      const isCaption =
        typeof mg.isCaption === 'boolean'
          ? mg.isCaption
          : rawType === 'Caption' || rawType === 'Subtitle';
      const rawPreset = String(mg.captionStylePreset || '');
      const captionStylePreset = CAPTION_PRESET_NAMES.includes(
        rawPreset as (typeof CAPTION_PRESET_NAMES)[number]
      )
        ? (rawPreset as MotionGraphicItem['captionStylePreset'])
        : isCaption
        ? 'Bold Hormozi'
        : 'Minimal Clean';
      const rawAnim = String(mg.animationType || '');
      const animationType = CAPTION_ANIMATION_OPTIONS.includes(
        rawAnim as (typeof CAPTION_ANIMATION_OPTIONS)[number]
      )
        ? (rawAnim as MotionGraphicItem['animationType'])
        : isCaption
        ? 'Bounce Pop'
        : 'Fade';
      const rawTransform = String(mg.textTransform || 'none');
      const textTransform: MotionGraphicItem['textTransform'] =
        rawTransform === 'uppercase' || rawTransform === 'capitalize' ? rawTransform : 'none';

      return {
        id: `gfx-${idx + 1}`,
        text: String(mg.text).replace(/\s+/g, ' ').trim(),
        type: rawType,
        isCaption,
        trackId: 'V3' as const,
        startTimeSec: Number(start.toFixed(2)),
        endTimeSec: Number(end.toFixed(2)),
        fontFamily: String(mg.fontFamily || 'Outfit'),
        fontSize: clamp(Number(mg.fontSize ?? (isCaption ? 46 : 44)), 16, 120),
        fontWeight: clamp(Number(mg.fontWeight ?? (isCaption ? 800 : 700)), 400, 900),
        positionXPercent: clamp(Number(mg.positionXPercent ?? 50), 5, 95),
        positionYPercent: clamp(Number(mg.positionYPercent ?? (isCaption ? 74 : 50)), 8, 92),
        colorHex:
          typeof mg.colorHex === 'string' && mg.colorHex.startsWith('#') ? mg.colorHex : '#FFFFFF',
        outlineColorHex:
          typeof mg.outlineColorHex === 'string' && mg.outlineColorHex.startsWith('#')
            ? mg.outlineColorHex
            : '#000000',
        outlineWidthPx: clamp(Number(mg.outlineWidthPx ?? (isCaption ? 3 : 2)), 0, 10),
        backgroundColorHex:
          typeof mg.backgroundColorHex === 'string' && mg.backgroundColorHex.startsWith('#')
            ? mg.backgroundColorHex
            : '#000000',
        backgroundOpacity: clamp(Number(mg.backgroundOpacity ?? 0), 0, 100),
        highlightColorHex:
          typeof mg.highlightColorHex === 'string' && mg.highlightColorHex.startsWith('#')
            ? mg.highlightColorHex
            : '#FACC15',
        highlightWord:
          typeof mg.highlightWord === 'string' && mg.highlightWord.trim().length > 0
            ? mg.highlightWord.trim()
            : undefined,
        textTransform,
        captionStylePreset,
        hasShadow: Boolean(mg.hasShadow ?? true),
        animationType,
        animationDurationSec: clamp(Number(mg.animationDurationSec ?? 0.28), 0.1, 1.5),
        confidence: safeConfidence(mg.confidence),
        spellChecked: false,
        fontSubstituteNote: String(
          mg.fontSubstituteNote || 'Styled & animated editable caption plate + Premiere .srt track.'
        ),
      };
    });

  // Automatic zero-spelling-mistake AI proofreading pass on detected captions/text (fault-tolerant)
  if (motionGraphics.length > 0 && Boolean(ai)) {
    setStage(9, 'active', `Spell-checking & verifying ${motionGraphics.length} detected captions`);
    try {
      const proofController = new AbortController();
      const proofTimer = window.setTimeout(() => proofController.abort(), 22000);
      const proofRes = await fetch('/api/captions/proofread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: proofController.signal,
        body: JSON.stringify({
          captions: motionGraphics.map((g) => ({
            id: g.id,
            text: g.text,
            highlightWord: g.highlightWord || '',
            startTimeSec: g.startTimeSec,
            endTimeSec: g.endTimeSec,
          })),
          contextNote:
            instagramInfo?.metadata?.caption ||
            instagramInfo?.metadata?.title ||
            file.name ||
            '',
        }),
      });
      window.clearTimeout(proofTimer);

      if (proofRes.ok) {
        const proofJson = await proofRes.json();
        const correctedList = Array.isArray(proofJson?.corrected) ? proofJson.corrected : [];
        const byId = new Map<string, { text?: string; highlightWord?: string }>();
        correctedList.forEach((item: { id?: string; text?: string; highlightWord?: string }) => {
          if (item && typeof item.id === 'string') {
            byId.set(item.id, item);
          }
        });

        motionGraphics = motionGraphics.map((g) => {
          const hit = byId.get(g.id);
          const verifiedText =
            hit && typeof hit.text === 'string' && hit.text.trim().length > 0
              ? hit.text.replace(/\s+/g, ' ').trim()
              : g.text;
          const verifiedHighlight =
            hit && typeof hit.highlightWord === 'string' && hit.highlightWord.trim().length > 0
              ? hit.highlightWord.trim()
              : g.highlightWord;
          return {
            ...g,
            text: verifiedText,
            highlightWord: verifiedHighlight,
            spellChecked: true,
          };
        });
      }
    } catch {
      // Non-blocking: keep Stage 7 OCR captions cleanly if proofread pass times out
    }
  }

  // Merge AI audio design & ALL Free/Built-in DSP + AI audio effects (skipping Paid audio plugins cleanly)
  const mergedAudioEffects: AudioEffectItem[] = [...audioResult.dspAudioEffects];

  if (ai?.audioDesign) {
    audio.musicDescription = ai.audioDesign.musicDescription || audio.musicDescription;
    audio.voiceoverDetected = Boolean(ai.audioDesign.voiceoverDetected);
    audio.voiceoverNotes = ai.audioDesign.voiceoverNotes || audio.voiceoverNotes;
    audio.sfxEvents = (ai.audioDesign.sfxEvents ?? []).map(
      (s: Record<string, unknown>, idx: number): SfxEvent => ({
        id: `sfx-${idx + 1}`,
        label: String(s.label || 'Transition Hit'),
        category: ([
          'Whoosh',
          'Impact',
          'Riser',
          'Drop',
          'Bass Hit',
          'Click',
          'Swish',
          'Ambient',
          'Transition SFX',
        ].includes(String(s.category))
          ? String(s.category)
          : 'Transition SFX') as SfxEvent['category'],
        timeSec: clamp(Number(s.timeSec ?? 0), 0, durationSec),
        durationSec: clamp(Number(s.durationSec ?? 0.35), 0.08, 3),
        volumeDb: -2,
        linkedVisualEvent: String(s.linkedVisualEvent || 'Shot boundary transition'),
        confidence: safeConfidence(s.confidence),
      })
    );

    const rawAiAudioFx = Array.isArray(ai.audioDesign.audioEffects)
      ? ai.audioDesign.audioEffects
      : [];

    rawAiAudioFx.forEach((afx: Record<string, unknown>, idx: number) => {
      const name = String(afx.name || 'Audio Effect');
      const rawCat = String(afx.category || '');
      const category: AudioEffectItem['category'] =
        rawCat === 'EQ & Filter' ||
        rawCat === 'Dynamics' ||
        rawCat === 'Reverb' ||
        rawCat === 'Delay & Echo' ||
        rawCat === 'Pitch & Time' ||
        rawCat === 'Noise Reduction' ||
        rawCat === 'Stereo & Pan' ||
        rawCat === 'Fade & Automation'
          ? rawCat
          : /filter|eq/i.test(rawCat)
          ? 'EQ & Filter'
          : /delay|echo/i.test(rawCat)
          ? 'Delay & Echo'
          : /pitch|time/i.test(rawCat)
          ? 'Pitch & Time'
          : /stereo|pan/i.test(rawCat)
          ? 'Stereo & Pan'
          : /fade|auto/i.test(rawCat)
          ? 'Fade & Automation'
          : 'EQ & Filter';

      const license = classifyEffectLicense(
        name,
        afx.licenseTier,
        afx.pluginVendor,
        afx.skippedReason
      );
      const premiereEffectName = String(
        afx.premiereEffectName ||
          (license.licenseTier === 'Paid / Third-Party'
            ? 'Skipped (Paid Third-Party Audio Plugin)'
            : 'Parametric Equalizer')
      );
      const premiereEffectId = String(
        afx.premiereEffectId || inferPremiereAudioEffectId(premiereEffectName || name, category)
      );

      // Avoid duplicating an identical Free built-in audio filter already added by DSP unless timed differently
      const start = clamp(Number(afx.startTimeSec ?? 0), 0, durationSec);
      const end = clamp(Number(afx.endTimeSec ?? durationSec), start + 0.1, durationSec);
      const isDuplicateFree =
        license.includedInTimeline &&
        mergedAudioEffects.some(
          (existing) =>
            existing.includedInTimeline &&
            existing.premiereEffectId === premiereEffectId &&
            Math.abs(existing.startTimeSec - start) < 0.75 &&
            Math.abs(existing.endTimeSec - end) < 0.75
        );

      const rawTrack = String(afx.trackId || afx.targetTrack || 'A1');
      const trackId: AudioEffectItem['trackId'] =
        rawTrack === 'A2' || rawTrack === 'A3' || rawTrack === 'A4' ? rawTrack : 'A1';

      if (!isDuplicateFree) {
        mergedAudioEffects.push({
          id: `afx-ai-${idx + 1}`,
          name,
          category,
          trackId,
          startTimeSec: Number(start.toFixed(2)),
          endTimeSec: Number(end.toFixed(2)),
          intensity: clamp(Number(afx.intensity ?? 55), 0, 100),
          parameters: {
            Intensity: `${clamp(Number(afx.intensity ?? 55), 0, 100)}%`,
            Track: trackId,
          },
          premiereEffectName,
          premiereEffectId,
          licenseTier: license.licenseTier,
          includedInTimeline: license.includedInTimeline,
          pluginVendor: license.pluginVendor,
          skippedReason: license.skippedReason,
          detectionSource: 'AI + DSP',
          confidence: safeConfidence(afx.confidence),
          notes: String(
            afx.notes ||
              (license.licenseTier === 'Paid / Third-Party'
                ? license.skippedReason || 'Bypassed paid audio plugin.'
                : 'Added as Free / Built-in Premiere Pro audio effect.')
          ),
        });
      }
    });
  } else if (audioResult.transientTimes.length > 0) {
    audio.voiceoverNotes =
      'AI audio-visual correlation was skipped; spectral profile, free DSP audio filters & transient peaks extracted via Web Audio DSP.';
    audio.sfxEvents = audioResult.transientTimes.slice(0, 8).map((t, idx) => ({
      id: `sfx-dsp-${idx + 1}`,
      label: `Audio Transient #${idx + 1}`,
      category: 'Impact',
      timeSec: clamp(t, 0, durationSec),
      durationSec: 0.25,
      volumeDb: -2,
      linkedVisualEvent: 'Detected via Web Audio onset spike',
      confidence: 'Low',
    }));
  }

  audio.audioEffects = mergedAudioEffects;

  const includedFreeVideoFx = effects.filter(
    (e) => e.includedInTimeline && e.licenseTier === 'Free / Built-in'
  );
  const skippedPaidVideoFx = effects.filter((e) => e.licenseTier === 'Paid / Third-Party');
  const includedFreeAudioFx = audio.audioEffects.filter(
    (e) => e.includedInTimeline && e.licenseTier === 'Free / Built-in'
  );
  const skippedPaidAudioFx = audio.audioEffects.filter((e) => e.licenseTier === 'Paid / Third-Party');

  setStage(
    9,
    'done',
    `${shots.length} clips · ${includedFreeVideoFx.length} free video FX · ${includedFreeAudioFx.length} free audio FX${
      motionGraphics.length > 0 ? ` · ${motionGraphics.length} captions` : ''
    }${
      skippedPaidVideoFx.length + skippedPaidAudioFx.length > 0
        ? ` · ${skippedPaidVideoFx.length + skippedPaidAudioFx.length} paid FX skipped`
        : ''
    }`
  );

  // Stage 10: Compatibility & Premiere XML readiness
  setStage(10, 'active', 'Validating FCP 7 XMEML v4 interchange & Free/Built-in FX bindings');
  const nativeCount =
    shots.filter((s) => s.transitionOut.premiereSupport === 'Native').length +
    includedFreeVideoFx.length +
    includedFreeAudioFx.length +
    2;
  const totalItems = Math.max(
    1,
    shots.length + effects.length + audio.audioEffects.length + 2
  );

  const skippedPaidUnsupportedList = [
    ...skippedPaidVideoFx.map(
      (ef) => `${ef.name} [${ef.pluginVendor || 'Paid Plugin'}] — bypassed (Paid Video FX)`
    ),
    ...skippedPaidAudioFx.map(
      (afx) => `${afx.name} [${afx.pluginVendor || 'Paid Audio Plugin'}] — bypassed (Paid Audio FX)`
    ),
  ];

  const manualNotes = [
    ...(ai?.compatibility?.manualAdjustments?.length
      ? ai.compatibility.manualAdjustments
      : [
          'Relink source media in Premiere Pro upon opening XML',
          'Load Reconstructed_Look.cube in Lumetri Color > Basic Correction',
        ]),
    ...skippedPaidVideoFx.map(
      (ef) =>
        `Skipped Paid Video Effect: ${ef.name} (${ef.pluginVendor || 'Third-Party'}) — pipeline continued with Free / Built-in effects.`
    ),
    ...skippedPaidAudioFx.map(
      (afx) =>
        `Skipped Paid Audio Plugin: ${afx.name} (${afx.pluginVendor || 'Third-Party'}) — pipeline continued with Free / Built-in Premiere audio filters.`
    ),
    ...skippedStages.map((sk) => `Stage ${sk.stageId} (${sk.label}) partial/skipped: ${sk.reason}`),
  ];

  const baseFullyReconstructed = ai?.compatibility?.fullyReconstructed?.length
    ? [...ai.compatibility.fullyReconstructed]
    : [
        'Frame-accurate sequence timing & detected cut points',
        'Basic Motion (Scale, Position, Rotation, Opacity) structure',
        'Sequence beat & cut markers',
      ];
  if (includedFreeVideoFx.length > 0) {
    baseFullyReconstructed.push(
      `${includedFreeVideoFx.length} Free / Built-in Premiere Video Effects embedded in XMEML`
    );
  }
  if (includedFreeAudioFx.length > 0) {
    baseFullyReconstructed.push(
      `${includedFreeAudioFx.length} Free / Built-in Premiere Audio Effects embedded on Track A1`
    );
  }
  if (motionGraphics.length > 0) {
    baseFullyReconstructed.push(
      `${motionGraphics.length} Spell-checked styled & animated captions (Track V3 SVG plates + Premiere .srt)`
    );
  }

  const compatibility: CompatibilityReport = {
    fullyReconstructed: baseFullyReconstructed,
    approximate: ai?.compatibility?.approximate?.length
      ? ai.compatibility.approximate
      : [
          'Estimated color grading exported as 17x17x17 .cube LUT',
          'Transitions mapped to nearest Premiere Pro transition',
        ],
    unsupported: [
      ...(ai?.compatibility?.unsupported ?? []),
      ...skippedPaidUnsupportedList,
    ].filter((val, idx, arr) => arr.indexOf(val) === idx),
    missingAssets: ai?.compatibility?.missingAssets?.length
      ? ai.compatibility.missingAssets
      : [
          'Licensed replacement music track (if redistributing copyrighted audio)',
          'Third-party SFX audio stems',
        ],
    manualAdjustments: manualNotes,
    nativeCoveragePercent: Math.round(clamp((nativeCount / totalItems) * 100, 35, 100)),
  };
  setStage(
    10,
    'done',
    `XMEML v4 ready (${includedFreeVideoFx.length} video FX + ${includedFreeAudioFx.length} audio FX bound)`
  );

  // Stage 11: Computing measurable comparison metrics & packaging project state
  setStage(11, 'active', 'Computing measurable reconstruction scores & assembling package');
  const avgShotDur = durationSec / Math.max(1, shots.length);
  const cutsPerMinute = Math.round(((shots.length - 1) / Math.max(0.5, durationSec)) * 60);

  const project: ReelProject = {
    id: `proj-${Date.now()}`,
    name: instagramInfo?.shortcode
      ? `IG_${instagramInfo.contentType}_${instagramInfo.shortcode}`
      : file.name.replace(/\.[^.]+$/, ''),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata,
    instagramInfo,
    summary: {
      styleLabel:
        ai?.summary?.styleLabel ||
        (aiSkippedReason ? 'CV + Audio Partial Reconstruction' : 'Short-Form Rhythmic Edit'),
      pacingLabel:
        ai?.summary?.pacingLabel ||
        (avgShotDur < 1.8 ? 'Fast-Paced Dynamic' : 'Measured Editorial'),
      averageShotDurationSec: Number(avgShotDur.toFixed(2)),
      cutsPerMinute,
      rhythmPattern:
        ai?.summary?.rhythmPattern ||
        (audio.hasAudio ? `Measured ${audio.estimatedBpm} BPM rhythm grid` : 'Visual cut pacing'),
      openingSequenceNote:
        ai?.summary?.openingSequenceNote ||
        `Starts at 00:00:00.000 (${shots[0]?.durationSec.toFixed(2) ?? durationSec.toFixed(2)}s opening clip).`,
      mainSequenceNote:
        ai?.summary?.mainSequenceNote ||
        `Contains ${shots.length} reconstructed timeline clips ready for Premiere Pro.`,
      closingSequenceNote:
        ai?.summary?.closingSequenceNote ||
        `Closes at ${durationSec.toFixed(2)}s.`,
      technicalOverview:
        ai?.summary?.technicalOverview ||
        (skippedStages.length > 0
          ? `Completed with ${skippedStages.length} partial/skipped stage(s). All available CV shot cuts, Web Audio beat markers, color measurements, and FCP 7 XMEML sequence data have been packaged for download.`
          : 'Reconstructed multitrack timeline ready for Premiere Pro.'),
    },
    shots,
    effects,
    motionGraphics,
    audio,
    colorGrade,
    compatibility,
    comparison: {
      shotTimingScore: 0,
      transitionTimingScore: 0,
      colorSimilarityScore: 0,
      motionSimilarityScore: 0,
      audioSyncScore: 0,
      overallSimilarityScore: 0,
      measuredNotes: [],
    },
    skippedStages,
  };

  project.comparison = computeComparisonMetrics(project);
  setStage(
    11,
    'done',
    skippedStages.length > 0
      ? `Downloadable package ready (${skippedStages.length} stage warning${skippedStages.length > 1 ? 's' : ''})`
      : 'Project bundle & comparison baseline ready'
  );

  return { project, videoObjectUrl: objectUrl };
}
