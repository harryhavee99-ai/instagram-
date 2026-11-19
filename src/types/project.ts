export type NavPage =
  | 'dashboard'
  | 'import-instagram'
  | 'upload-video'
  | 'video-analysis'
  | 'shot-breakdown'
  | 'audio-analysis'
  | 'color-analysis'
  | 'effects-analysis'
  | 'reconstruction-editor'
  | 'timeline-editor'
  | 'comparison'
  | 'premiere-export'
  | 'project-history'
  | 'settings';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';
export type CompatibilityStatus = 'Native' | 'Approximate' | 'Unsupported';
export type EffectLicenseTier = 'Free / Built-in' | 'Paid / Third-Party';

export interface InstagramInspectResult {
  valid: boolean;
  url: string;
  normalizedUrl?: string;
  shortcode?: string;
  contentType?: 'Reel' | 'Video Post' | 'IGTV';
  creatorHandle?: string;
  oEmbedAvailable: boolean;
  oEmbedConfigured: boolean;
  directVideoAvailable: boolean;
  metadata?: {
    title?: string;
    caption?: string;
    hashtags?: string[];
    authorName?: string;
    authorUrl?: string;
    thumbnailUrl?: string;
    thumbnailWidth?: number;
    thumbnailHeight?: number;
    providerName?: string;
    aspectRatio?: string;
    estimatedDurationSec?: number;
    publicMetaExtracted?: boolean;
    queryParamsDetected?: string[];
  };
  accessNotice: string;
  error?: string;
}

export interface VideoMetadata {
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  container: string;
  codec: string;
  width: number;
  height: number;
  aspectRatio: string;
  durationSec: number;
  fps: number;
  bitrateKbps: number;
  audioSampleRate: number;
  audioChannels: number;
  colorSpace: string;
  hdrDetected: boolean;
  proxyScale: number;
  sourceOrigin: 'instagram-upload' | 'direct-upload' | 'sample-reel';
  sourceUrl?: string;
}

export interface KeyframePoint {
  id: string;
  timeSec: number; // relative to clip start
  property: 'scale' | 'positionX' | 'positionY' | 'rotation' | 'opacity' | 'speed' | 'volume';
  value: number;
  easing: 'Linear' | 'Ease In' | 'Ease Out' | 'Bezier';
}

export interface ColorGradeSettings {
  profileName: string;
  exposure: number; // -2 to +2 EV
  contrast: number; // -100 to +100
  highlights: number; // -100 to +100
  shadows: number; // -100 to +100
  whites: number; // -100 to +100
  blacks: number; // -100 to +100
  temperature: number; // -100 to +100
  tint: number; // -100 to +100
  saturation: number; // 0 to 200 (100 neutral)
  vibrance: number; // -100 to +100
  hueShift: number; // -30 to +30 deg
  vignette: number; // 0 to 100
  sharpening: number; // 0 to 100
  fade: number; // 0 to 100
  filmGrain: number; // 0 to 100
  rgbCurves: {
    redLift: number;
    redGain: number;
    greenLift: number;
    greenGain: number;
    blueLift: number;
    blueGain: number;
  };
  skinToneNote: string;
  confidence: ConfidenceLevel;
  confidenceScore: number; // 0-100
  measuredHistogram?: {
    r: number[];
    g: number[];
    b: number[];
    luma: number[];
  };
}

export interface ShotTransition {
  type:
    | 'Cut'
    | 'Cross Dissolve'
    | 'Fade In'
    | 'Fade Out'
    | 'Zoom Transition'
    | 'Whip Pan'
    | 'Push'
    | 'Slide'
    | 'Blur Transition'
    | 'Flash Transition'
    | 'Glitch'
    | 'Light Leak'
    | 'Mask Reveal';
  durationSec: number;
  intensity: number; // 0-100
  direction: 'None' | 'In' | 'Out' | 'Left' | 'Right' | 'Up' | 'Down';
  confidence: ConfidenceLevel;
  premiereSupport: CompatibilityStatus;
  premiereMapping: string;
}

export interface ShotClip {
  id: string;
  index: number;
  name: string;
  trackId: 'V1' | 'V2';
  startTimeSec: number;
  endTimeSec: number;
  sourceInSec: number;
  sourceOutSec: number;
  durationSec: number;
  thumbnailDataUrl: string;
  shotType: string; // Close-up, Medium, Wide, Detail, POV, etc.
  section: 'Opening' | 'Main' | 'Closing';
  subjectPosition: string;
  cameraMovement: string;
  speedPercent: number; // 100 = normal
  speedRampProfile: string;
  scale: number; // percentage, 100 default
  positionX: number; // px offset from center
  positionY: number; // px offset from center
  rotation: number; // degrees
  opacity: number; // 0-100
  transitionOut: ShotTransition;
  keyframes: KeyframePoint[];
  colorShiftNote: string;
  measuredMotionScore: number; // 0-100 from CV
  measuredCutDelta: number; // 0-100 histogram delta
  beatAligned: boolean;
  alignedBeatTimeSec?: number;
  confidence: ConfidenceLevel;
  description: string;
}

export interface EffectItem {
  id: string;
  name: string;
  category: 'Transition' | 'Motion' | 'Blur' | 'Stylize' | 'Light' | 'Speed' | 'Mask' | 'Distort' | 'Color';
  shotId?: string;
  startTimeSec: number;
  endTimeSec: number;
  durationSec: number;
  intensity: number; // 0-100
  direction: string;
  parameters: Record<string, string | number>;
  confidence: ConfidenceLevel;
  licenseTier: EffectLicenseTier;
  includedInTimeline: boolean;
  pluginVendor?: string;
  skippedReason?: string;
  premiereSupport: CompatibilityStatus;
  premiereEffectName: string;
  premiereEffectId?: string;
  approximationNote: string;
}

export interface AudioEffectItem {
  id: string;
  name: string;
  category:
    | 'EQ & Filter'
    | 'Dynamics'
    | 'Reverb'
    | 'Delay & Echo'
    | 'Pitch & Time'
    | 'Noise Reduction'
    | 'Stereo & Pan'
    | 'Fade & Automation';
  trackId: 'A1' | 'A2' | 'A3' | 'A4';
  startTimeSec: number;
  endTimeSec: number;
  intensity: number; // 0-100
  parameters: Record<string, string | number>;
  licenseTier: EffectLicenseTier;
  includedInTimeline: boolean;
  pluginVendor?: string;
  skippedReason?: string;
  premiereEffectName: string;
  premiereEffectId: string;
  detectionSource?: 'Web Audio DSP' | 'AI + DSP';
  confidence: ConfidenceLevel;
  notes: string;
}

export interface AudioSpectralProfile {
  subBassEnergy: number; // 0-100 (20-80 Hz)
  bassEnergy: number; // 0-100 (80-250 Hz)
  midEnergy: number; // 0-100 (250-3500 Hz)
  highEnergy: number; // 0-100 (3500-16000 Hz)
  integratedRmsDb: number; // approx dBFS
  peakDb: number;
  dynamicRangeDb: number;
  stereoWidthPercent: number; // 0 mono .. 100 wide
  reverbTailEstimate: 'Dry' | 'Subtle Room' | 'Medium Hall' | 'Heavy Wash';
  lowPassFilterDetected: boolean;
  sidechainOrDuckingDetected: boolean;
}

export type CaptionStylePreset =
  | 'Bold Hormozi'
  | 'Karaoke Highlight'
  | 'Boxed Pill'
  | 'Neon Glow'
  | 'Outline Impact'
  | 'Minimal Clean'
  | 'Typewriter Mono';

export type CaptionAnimationType =
  | 'None'
  | 'Fade'
  | 'Pop In'
  | 'Bounce Pop'
  | 'Slide Up'
  | 'Kinetic Scale'
  | 'Word Highlight'
  | 'Karaoke Sweep'
  | 'Typewriter'
  | 'Glow Pulse';

export interface MotionGraphicItem {
  id: string;
  text: string;
  type: 'Title' | 'Subtitle' | 'Caption' | 'Lower Third' | 'Callout' | 'Logo' | 'Shape';
  isCaption?: boolean;
  trackId: 'V3';
  startTimeSec: number;
  endTimeSec: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  positionXPercent: number; // 0-100
  positionYPercent: number; // 0-100
  colorHex: string;
  outlineColorHex: string;
  outlineWidthPx?: number;
  backgroundColorHex?: string;
  backgroundOpacity?: number; // 0-100
  highlightColorHex?: string;
  highlightWord?: string;
  textTransform?: 'none' | 'uppercase' | 'capitalize';
  captionStylePreset?: CaptionStylePreset;
  hasShadow: boolean;
  animationType: CaptionAnimationType;
  animationDurationSec: number;
  spellChecked?: boolean;
  confidence: ConfidenceLevel;
  fontSubstituteNote: string;
}

export interface BeatMarker {
  id: string;
  timeSec: number;
  barNumber: number;
  beatInBar: number;
  isDownbeat: boolean;
  strength: number; // 0-1
  syncedShotId?: string;
}

export interface SfxEvent {
  id: string;
  label: string;
  category: 'Whoosh' | 'Impact' | 'Riser' | 'Drop' | 'Bass Hit' | 'Click' | 'Swish' | 'Ambient' | 'Transition SFX';
  timeSec: number;
  durationSec: number;
  volumeDb: number;
  linkedVisualEvent: string;
  confidence: ConfidenceLevel;
}

export interface AudioSection {
  name: 'Intro' | 'Build-up' | 'Drop' | 'Chorus' | 'Bridge' | 'Outro';
  startTimeSec: number;
  endTimeSec: number;
  energyLevel: number; // 0-100
}

export interface AudioTrackMix {
  id: 'A1' | 'A2' | 'A3' | 'A4';
  name: string;
  role: 'Original Audio' | 'Background Music' | 'Sound Effects' | 'Voiceover';
  volumeDb: number; // -48 to +12
  muted: boolean;
  solo: boolean;
  fadeInSec: number;
  fadeOutSec: number;
  replacementFileName?: string;
  licensingNote: string;
}

export interface AudioAnalysis {
  hasAudio: boolean;
  sampleRate: number;
  channels: number;
  durationSec: number;
  estimatedBpm: number;
  bpmConfidence: ConfidenceLevel;
  waveformPeaks: number[]; // normalized 0..1 array
  energyCurve: number[];
  beats: BeatMarker[];
  sections: AudioSection[];
  sfxEvents: SfxEvent[];
  audioEffects: AudioEffectItem[];
  spectralProfile?: AudioSpectralProfile;
  musicDescription: string;
  voiceoverDetected: boolean;
  voiceoverNotes: string;
  sourceSeparationNote: string;
  tracks: AudioTrackMix[];
}

export interface CompatibilityReport {
  fullyReconstructed: string[];
  approximate: string[];
  unsupported: string[];
  missingAssets: string[];
  manualAdjustments: string[];
  nativeCoveragePercent: number;
}

export interface ComparisonMetrics {
  shotTimingScore: number;
  transitionTimingScore: number;
  colorSimilarityScore: number;
  motionSimilarityScore: number;
  audioSyncScore: number;
  overallSimilarityScore: number;
  measuredNotes: string[];
}

export interface AnalysisPipelineStage {
  id: number;
  label: string;
  status: 'pending' | 'active' | 'done' | 'warning' | 'error';
  detail?: string;
}

export interface EditingSummary {
  styleLabel: string;
  pacingLabel: string;
  averageShotDurationSec: number;
  cutsPerMinute: number;
  rhythmPattern: string;
  openingSequenceNote: string;
  mainSequenceNote: string;
  closingSequenceNote: string;
  technicalOverview: string;
}

export interface SkippedStageNotice {
  stageId: number;
  label: string;
  reason: string;
}

export interface ReelProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  metadata: VideoMetadata;
  instagramInfo?: InstagramInspectResult;
  summary: EditingSummary;
  shots: ShotClip[];
  effects: EffectItem[];
  motionGraphics: MotionGraphicItem[];
  audio: AudioAnalysis;
  colorGrade: ColorGradeSettings;
  compatibility: CompatibilityReport;
  comparison: ComparisonMetrics;
  skippedStages?: SkippedStageNotice[];
}

export interface AppSettings {
  defaultTimebase: 24 | 25 | 30 | 60;
  samplingDensity: 'Balanced' | 'High Precision' | 'Fast Draft';
  proxyQuality: '720p Proxy' | '540p Proxy' | 'Original';
  beatSnapToleranceMs: number;
  includeSourceMediaInZip: boolean;
  autoGenerateCubeLut: boolean;
  rightsAcknowledged: boolean;
}
