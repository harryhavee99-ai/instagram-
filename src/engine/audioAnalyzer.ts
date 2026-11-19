import type {
  AudioAnalysis,
  AudioEffectItem,
  AudioSection,
  AudioSpectralProfile,
  AudioTrackMix,
  BeatMarker,
  ConfidenceLevel,
} from '../types/project';

export interface RawAudioMeasurements {
  analysis: AudioAnalysis;
  transientTimes: number[];
  hasFadeIn: boolean;
  hasFadeOut: boolean;
  spectralProfile?: AudioSpectralProfile;
  dspAudioEffects: AudioEffectItem[];
}

function buildDefaultTracks(hasAudio: boolean, fadeInSec: number, fadeOutSec: number): AudioTrackMix[] {
  return [
    {
      id: 'A1',
      name: 'Original Mixed Audio',
      role: 'Original Audio',
      volumeDb: hasAudio ? 0 : -48,
      muted: !hasAudio,
      solo: false,
      fadeInSec,
      fadeOutSec,
      licensingNote: 'Preserved from authorized user-provided source media.',
    },
    {
      id: 'A2',
      name: 'Background Music Reference',
      role: 'Background Music',
      volumeDb: -3,
      muted: false,
      solo: false,
      fadeInSec,
      fadeOutSec,
      licensingNote:
        'Beat grid & timing markers reconstructed. Supply your own licensed music file for redistribution.',
    },
    {
      id: 'A3',
      name: 'Sound Effects (Transitions & Hits)',
      role: 'Sound Effects',
      volumeDb: -2,
      muted: false,
      solo: false,
      fadeInSec: 0,
      fadeOutSec: 0,
      licensingNote: 'SFX cue positions synced to detected visual cuts and audio transients.',
    },
    {
      id: 'A4',
      name: 'Voiceover / Dialogue Cue',
      role: 'Voiceover',
      volumeDb: 0,
      muted: false,
      solo: false,
      fadeInSec: 0,
      fadeOutSec: 0,
      licensingNote: 'Reserved track for detected speech segments or user replacement voiceover.',
    },
  ];
}

/**
 * Computes real 4-band spectral energies (Sub-Bass, Bass, Mid, High),
 * integrated RMS dBFS, peak dBFS, dynamic range, stereo width,
 * reverb tail decay estimate, low-pass filter cue, and ducking dips.
 */
function computeSpectralAndDynamicsProfile(
  audioBuffer: AudioBuffer,
  mono: Float32Array,
  rmsEnv: Float32Array
): AudioSpectralProfile {
  const sr = audioBuffer.sampleRate;
  const len = mono.length;
  // Subsample stride for very long clips while keeping filter coefficients accurate
  const maxSamples = Math.min(len, sr * 45);

  const alphaSub = 1 - Math.exp((-2 * Math.PI * 80) / sr);
  const alphaBass = 1 - Math.exp((-2 * Math.PI * 250) / sr);
  const alphaMid = 1 - Math.exp((-2 * Math.PI * 3500) / sr);

  let lpSub = 0;
  let lpBass = 0;
  let lpMid = 0;

  let eSub = 0;
  let eBass = 0;
  let eMid = 0;
  let eHigh = 0;
  let sumSq = 0;
  let peak = 0.00001;

  for (let i = 0; i < maxSamples; i++) {
    const x = mono[i];
    const ax = Math.abs(x);
    if (ax > peak) peak = ax;
    sumSq += x * x;

    lpSub += alphaSub * (x - lpSub);
    lpBass += alphaBass * (x - lpBass);
    lpMid += alphaMid * (x - lpMid);

    const sub = lpSub;
    const bass = lpBass - lpSub;
    const mid = lpMid - lpBass;
    const high = x - lpMid;

    eSub += sub * sub;
    eBass += bass * bass;
    eMid += mid * mid;
    eHigh += high * high;
  }

  const rmsTotal = Math.sqrt(sumSq / Math.max(1, maxSamples));
  const integratedRmsDb = Number(Math.max(-60, 20 * Math.log10(Math.max(1e-5, rmsTotal))).toFixed(1));
  const peakDb = Number(Math.max(-60, 20 * Math.log10(Math.max(1e-5, peak))).toFixed(1));
  const dynamicRangeDb = Number(Math.max(1, peakDb - integratedRmsDb).toFixed(1));

  const rmsSub = Math.sqrt(eSub / Math.max(1, maxSamples));
  const rmsBass = Math.sqrt(eBass / Math.max(1, maxSamples));
  const rmsMid = Math.sqrt(eMid / Math.max(1, maxSamples));
  const rmsHigh = Math.sqrt(eHigh / Math.max(1, maxSamples));
  const bandSum = Math.max(1e-5, rmsSub + rmsBass + rmsMid + rmsHigh);

  const subBassEnergy = Math.min(100, Math.round((rmsSub / bandSum) * 210));
  const bassEnergy = Math.min(100, Math.round((rmsBass / bandSum) * 210));
  const midEnergy = Math.min(100, Math.round((rmsMid / bandSum) * 210));
  const highEnergy = Math.min(100, Math.round((rmsHigh / bandSum) * 240));

  // Stereo width via L-R side energy ratio
  let stereoWidthPercent = 0;
  if (audioBuffer.numberOfChannels >= 2) {
    const chL = audioBuffer.getChannelData(0);
    const chR = audioBuffer.getChannelData(1);
    let midSum = 0;
    let sideSum = 0;
    const step = Math.max(1, Math.floor(maxSamples / 40000));
    for (let i = 0; i < maxSamples; i += step) {
      const m = (chL[i] + chR[i]) * 0.5;
      const s = (chL[i] - chR[i]) * 0.5;
      midSum += m * m;
      sideSum += s * s;
    }
    const ratio = Math.sqrt(sideSum / Math.max(1e-8, midSum + sideSum));
    stereoWidthPercent = Math.min(100, Math.round(ratio * 185));
  }

  // Estimate reverb tail & sustain floor from RMS envelope decay
  let quietSustainedFrames = 0;
  let duckingDips = 0;
  for (let i = 2; i < rmsEnv.length - 2; i++) {
    if (rmsEnv[i] > 0.14 && rmsEnv[i] < 0.45 && Math.abs(rmsEnv[i] - rmsEnv[i - 1]) < 0.04) {
      quietSustainedFrames += 1;
    }
    if (rmsEnv[i - 2] > 0.55 && rmsEnv[i] < 0.28 && rmsEnv[i + 2] > 0.52) {
      duckingDips += 1;
    }
  }
  const sustainRatio = quietSustainedFrames / Math.max(1, rmsEnv.length);
  const reverbTailEstimate: AudioSpectralProfile['reverbTailEstimate'] =
    sustainRatio > 0.42
      ? 'Heavy Wash'
      : sustainRatio > 0.25
      ? 'Medium Hall'
      : sustainRatio > 0.12
      ? 'Subtle Room'
      : 'Dry';

  const lowPassFilterDetected = highEnergy < 16 && (subBassEnergy + bassEnergy) > 65;
  const sidechainOrDuckingDetected = duckingDips >= 2;

  return {
    subBassEnergy,
    bassEnergy,
    midEnergy,
    highEnergy,
    integratedRmsDb,
    peakDb,
    dynamicRangeDb,
    stereoWidthPercent,
    reverbTailEstimate,
    lowPassFilterDetected,
    sidechainOrDuckingDetected,
  };
}

/**
 * Generates grounded, Free / Built-in Adobe Premiere Pro Audio Effects
 * directly from real measured Web Audio DSP characteristics.
 */
function buildDspFreeAudioEffects(
  spectral: AudioSpectralProfile,
  durationSec: number,
  hasFadeIn: boolean,
  hasFadeOut: boolean
): AudioEffectItem[] {
  const list: AudioEffectItem[] = [];
  const end = Number(durationSec.toFixed(2));

  // 1. Parametric EQ if bass/sub-bass or mid/high shaping is prominent
  if (spectral.subBassEnergy >= 32 || spectral.bassEnergy >= 38 || spectral.highEnergy >= 35) {
    const bassBoostDb = Math.round(((spectral.subBassEnergy + spectral.bassEnergy) / 2 - 30) * 0.12);
    const highBoostDb = Math.round((spectral.highEnergy - 28) * 0.1);
    list.push({
      id: 'afx-dsp-eq',
      name: 'Parametric Equalizer (Tonal Shaping)',
      category: 'EQ & Filter',
      trackId: 'A1',
      startTimeSec: 0,
      endTimeSec: end,
      intensity: Math.min(100, Math.max(25, Math.round((spectral.bassEnergy + spectral.highEnergy) * 0.6))),
      parameters: {
        LowShelfGainDb: Math.max(-6, Math.min(8, bassBoostDb)),
        HighShelfGainDb: Math.max(-6, Math.min(8, highBoostDb)),
        MidFocusHz: 1800,
      },
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      premiereEffectName: 'Parametric Equalizer',
      premiereEffectId: 'ParametricEqualizer',
      confidence: 'High',
      notes: `Measured band energy: Sub ${spectral.subBassEnergy}% · Bass ${spectral.bassEnergy}% · Mid ${spectral.midEnergy}% · High ${spectral.highEnergy}%.`,
    });
  }

  // 2. Lowpass filter if muffled/underwater frequency balance detected
  if (spectral.lowPassFilterDetected) {
    list.push({
      id: 'afx-dsp-lpf',
      name: 'Lowpass Filter (Warm / Muffled Roll-Off)',
      category: 'EQ & Filter',
      trackId: 'A1',
      startTimeSec: 0,
      endTimeSec: Number(Math.min(end, Math.max(1.5, end * 0.35)).toFixed(2)),
      intensity: 72,
      parameters: { CutoffHz: 1100 },
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      premiereEffectName: 'Lowpass',
      premiereEffectId: 'Lowpass',
      confidence: 'Medium',
      notes: 'High-frequency roll-off detected relative to bass/sub-bass energy.',
    });
  }

  // 3. Single-band Compressor / Hard Limiter when dynamic range is tight (mastered/punched Reel audio)
  if (spectral.dynamicRangeDb <= 12.5) {
    list.push({
      id: 'afx-dsp-comp',
      name: 'Single-band Compressor (Punch & Loudness)',
      category: 'Dynamics',
      trackId: 'A1',
      startTimeSec: 0,
      endTimeSec: end,
      intensity: Math.min(95, Math.max(35, Math.round((15 - spectral.dynamicRangeDb) * 8))),
      parameters: {
        ThresholdDb: Number(Math.max(-24, spectral.integratedRmsDb - 2).toFixed(1)),
        Ratio: spectral.dynamicRangeDb < 8 ? '4.0:1' : '2.5:1',
        PeakCeilingDb: spectral.peakDb,
      },
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      premiereEffectName: 'Single-band Compressor',
      premiereEffectId: 'SingleBandCompressor',
      confidence: 'High',
      notes: `Measured RMS ${spectral.integratedRmsDb} dBFS with ${spectral.dynamicRangeDb} dB dynamic range.`,
    });
  }

  if (spectral.peakDb >= -2.0) {
    list.push({
      id: 'afx-dsp-limiter',
      name: 'Hard Limiter (Ceiling Protection)',
      category: 'Dynamics',
      trackId: 'A1',
      startTimeSec: 0,
      endTimeSec: end,
      intensity: 65,
      parameters: { MaxAmplitudeDb: -1.0 },
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      premiereEffectName: 'Hard Limiter',
      premiereEffectId: 'HardLimiter',
      confidence: 'High',
      notes: `Peaks reach ${spectral.peakDb} dBFS; Premiere Hard Limiter prevents social loudness clipping.`,
    });
  }

  // 4. Studio Reverb when sustained decay tail is detected
  if (spectral.reverbTailEstimate !== 'Dry') {
    const wet =
      spectral.reverbTailEstimate === 'Heavy Wash'
        ? 55
        : spectral.reverbTailEstimate === 'Medium Hall'
        ? 32
        : 16;
    list.push({
      id: 'afx-dsp-reverb',
      name: `Studio Reverb (${spectral.reverbTailEstimate})`,
      category: 'Reverb',
      trackId: 'A1',
      startTimeSec: 0,
      endTimeSec: end,
      intensity: wet,
      parameters: { WetMixPercent: wet, DecaySec: spectral.reverbTailEstimate === 'Heavy Wash' ? 2.6 : 1.3 },
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      premiereEffectName: 'Studio Reverb',
      premiereEffectId: 'StudioReverb',
      confidence: 'Medium',
      notes: `Sustained ambient energy tail indicates ${spectral.reverbTailEstimate.toLowerCase()} spatial reverb.`,
    });
  }

  // 5. Stereo Expander if wide stereo image detected
  if (spectral.stereoWidthPercent >= 32) {
    list.push({
      id: 'afx-dsp-stereo',
      name: 'Stereo Width Imaging',
      category: 'Stereo & Pan',
      trackId: 'A1',
      startTimeSec: 0,
      endTimeSec: end,
      intensity: spectral.stereoWidthPercent,
      parameters: { WidthPercent: Math.min(180, 100 + Math.round(spectral.stereoWidthPercent * 0.6)) },
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      premiereEffectName: 'Stereo Expander',
      premiereEffectId: 'StereoExpander',
      confidence: 'Medium',
      notes: `Measured L/R stereo side width: ${spectral.stereoWidthPercent}%.`,
    });
  }

  // 6. Audio Fade Automation (Constant Power / Exponential Fade)
  if (hasFadeIn) {
    list.push({
      id: 'afx-dsp-fadein',
      name: 'Audio Fade In (Volume Automation)',
      category: 'Fade & Automation',
      trackId: 'A1',
      startTimeSec: 0,
      endTimeSec: Math.min(end, 0.75),
      intensity: 100,
      parameters: { DurationSec: 0.5 },
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      premiereEffectName: 'Constant Power Fade In',
      premiereEffectId: 'audiolevels',
      confidence: 'High',
      notes: 'Gradual opening volume ramp measured from audio envelope.',
    });
  }
  if (hasFadeOut) {
    list.push({
      id: 'afx-dsp-fadeout',
      name: 'Audio Fade Out (Volume Automation)',
      category: 'Fade & Automation',
      trackId: 'A1',
      startTimeSec: Math.max(0, Number((end - 0.8).toFixed(2))),
      endTimeSec: end,
      intensity: 100,
      parameters: { DurationSec: 0.75 },
      licenseTier: 'Free / Built-in',
      includedInTimeline: true,
      premiereEffectName: 'Exponential Fade Out',
      premiereEffectId: 'audiolevels',
      confidence: 'High',
      notes: 'Closing volume taper measured from audio envelope.',
    });
  }

  return list;
}

export async function analyzeAudioFromFile(
  file: File,
  fallbackDurationSec: number
): Promise<RawAudioMeasurements> {
  const emptyResult = (): RawAudioMeasurements => ({
    analysis: {
      hasAudio: false,
      sampleRate: 48000,
      channels: 2,
      durationSec: fallbackDurationSec,
      estimatedBpm: 0,
      bpmConfidence: 'Low',
      waveformPeaks: Array.from({ length: 160 }, () => 0.04),
      energyCurve: Array.from({ length: 40 }, () => 0),
      beats: [],
      sections: [
        {
          name: 'Intro',
          startTimeSec: 0,
          endTimeSec: fallbackDurationSec,
          energyLevel: 0,
        },
      ],
      sfxEvents: [],
      audioEffects: [],
      musicDescription: 'No decodable audio track detected in source media.',
      voiceoverDetected: false,
      voiceoverNotes: 'No audio signal available for speech detection.',
      sourceSeparationNote:
        'Source media has no decodable browser audio stream (silent video or unsupported audio codec).',
      tracks: buildDefaultTracks(false, 0, 0),
    },
    transientTimes: [],
    hasFadeIn: false,
    hasFadeOut: false,
    dspAudioEffects: [],
  });

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    return emptyResult();
  }

  let ctx: AudioContext | null = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    ctx = new AudioCtx();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

    const sampleRate = audioBuffer.sampleRate;
    const channels = audioBuffer.numberOfChannels;
    const durationSec = audioBuffer.duration || fallbackDurationSec;
    const length = audioBuffer.length;

    // Downmix to mono
    const mono = new Float32Array(length);
    for (let ch = 0; ch < channels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        mono[i] += data[i] / channels;
      }
    }

    // 1. Waveform peaks (240 bars)
    const numBars = 240;
    const blockSize = Math.max(1, Math.floor(length / numBars));
    const waveformPeaks: number[] = [];
    let globalPeak = 0.0001;
    for (let b = 0; b < numBars; b++) {
      const start = b * blockSize;
      const end = Math.min(length, start + blockSize);
      let maxAmp = 0;
      for (let i = start; i < end; i++) {
        const a = Math.abs(mono[i]);
        if (a > maxAmp) maxAmp = a;
      }
      waveformPeaks.push(maxAmp);
      if (maxAmp > globalPeak) globalPeak = maxAmp;
    }

    if (globalPeak < 0.002) {
      return emptyResult();
    }
    const normalizedWaveform = waveformPeaks.map((v) => Math.min(1, v / globalPeak));

    // 2. Short-time RMS energy envelope (every 20ms => 50 frames/sec)
    const hopSec = 0.02;
    const hopSamples = Math.max(1, Math.floor(sampleRate * hopSec));
    const numFrames = Math.max(1, Math.floor(length / hopSamples));
    const rmsEnv = new Float32Array(numFrames);
    let maxRms = 0.0001;
    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSamples;
      const end = Math.min(length, start + hopSamples);
      let sumSq = 0;
      for (let i = start; i < end; i++) {
        sumSq += mono[i] * mono[i];
      }
      const rms = Math.sqrt(sumSq / Math.max(1, end - start));
      rmsEnv[f] = rms;
      if (rms > maxRms) maxRms = rms;
    }
    for (let f = 0; f < numFrames; f++) {
      rmsEnv[f] /= maxRms;
    }

    // 3. Onset strength function
    const onset = new Float32Array(numFrames);
    for (let f = 1; f < numFrames; f++) {
      const diff = rmsEnv[f] - rmsEnv[f - 1];
      onset[f] = diff > 0 ? diff : 0;
    }

    // 4. BPM estimation via lag autocorrelation (70..175 BPM)
    const minLag = Math.round((60 / 175) / hopSec);
    const maxLag = Math.min(numFrames - 2, Math.round((60 / 70) / hopSec));
    let bestLag = Math.round((60 / 120) / hopSec);
    let bestCorr = -1;
    let avgCorr = 0;
    let corrCount = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i < numFrames - lag; i++) {
        sum += onset[i] * onset[i + lag];
      }
      const norm = sum / Math.max(1, numFrames - lag);
      avgCorr += norm;
      corrCount += 1;
      if (norm > bestCorr) {
        bestCorr = norm;
        bestLag = lag;
      }
    }

    const rawBpm = 60 / (bestLag * hopSec);
    const estimatedBpm = Math.round(Math.max(70, Math.min(175, rawBpm)));
    const corrRatio = corrCount > 0 && avgCorr > 0 ? bestCorr / (avgCorr / corrCount) : 1;
    const bpmConfidence: ConfidenceLevel =
      corrRatio > 2.2 ? 'High' : corrRatio > 1.35 ? 'Medium' : 'Low';

    // 5. Phase-align beat grid
    const beatPeriodSec = 60 / estimatedBpm;
    const firstBeatFrames = Math.min(numFrames, Math.ceil(beatPeriodSec / hopSec));
    let bestPhaseFrame = 0;
    let bestPhaseScore = -1;
    for (let offset = 0; offset < firstBeatFrames; offset++) {
      let score = 0;
      for (let idx = offset; idx < numFrames; idx += bestLag) {
        score += onset[idx] + rmsEnv[idx] * 0.4;
      }
      if (score > bestPhaseScore) {
        bestPhaseScore = score;
        bestPhaseFrame = offset;
      }
    }

    const firstBeatTime = bestPhaseFrame * hopSec;
    const beats: BeatMarker[] = [];
    let beatNum = 0;
    for (let t = firstBeatTime; t < durationSec - 0.05; t += beatPeriodSec) {
      const fIdx = Math.min(numFrames - 1, Math.round(t / hopSec));
      const barNumber = Math.floor(beatNum / 4) + 1;
      const beatInBar = (beatNum % 4) + 1;
      beats.push({
        id: `beat-${beatNum + 1}`,
        timeSec: Number(t.toFixed(3)),
        barNumber,
        beatInBar,
        isDownbeat: beatInBar === 1,
        strength: Number(Math.min(1, Math.max(0.25, rmsEnv[fIdx] * 0.8 + onset[fIdx] * 1.2)).toFixed(2)),
      });
      beatNum += 1;
    }

    // 6. Transient candidates
    const transientTimes: number[] = [];
    let meanOnset = 0;
    for (let f = 0; f < numFrames; f++) meanOnset += onset[f];
    meanOnset /= Math.max(1, numFrames);
    const threshold = Math.max(0.12, meanOnset * 2.8);

    let lastTransientSec = -0.5;
    for (let f = 2; f < numFrames - 2; f++) {
      if (onset[f] > threshold && onset[f] >= onset[f - 1] && onset[f] >= onset[f + 1]) {
        const t = f * hopSec;
        if (t - lastTransientSec >= 0.35) {
          transientTimes.push(Number(t.toFixed(2)));
          lastTransientSec = t;
        }
      }
    }

    // 7. Energy curve & musical sections
    const bucketCount = 40;
    const energyCurve: number[] = [];
    for (let b = 0; b < bucketCount; b++) {
      const start = Math.floor((b / bucketCount) * numFrames);
      const end = Math.max(start + 1, Math.floor(((b + 1) / bucketCount) * numFrames));
      let avg = 0;
      for (let i = start; i < end; i++) avg += rmsEnv[i];
      energyCurve.push(Math.round((avg / (end - start)) * 100));
    }

    const sections: AudioSection[] = [];
    if (durationSec <= 6) {
      sections.push(
        { name: 'Intro', startTimeSec: 0, endTimeSec: Number((durationSec * 0.35).toFixed(2)), energyLevel: energyCurve[4] ?? 50 },
        { name: 'Drop', startTimeSec: Number((durationSec * 0.35).toFixed(2)), endTimeSec: Number((durationSec * 0.85).toFixed(2)), energyLevel: Math.max(...energyCurve.slice(14, 34), 60) },
        { name: 'Outro', startTimeSec: Number((durationSec * 0.85).toFixed(2)), endTimeSec: Number(durationSec.toFixed(2)), energyLevel: energyCurve[38] ?? 35 }
      );
    } else {
      const q1 = Number((durationSec * 0.18).toFixed(2));
      const q2 = Number((durationSec * 0.38).toFixed(2));
      const q3 = Number((durationSec * 0.78).toFixed(2));
      const avgSlice = (s: number, e: number) => {
        const sl = energyCurve.slice(s, e);
        return sl.length ? Math.round(sl.reduce((a, b) => a + b, 0) / sl.length) : 50;
      };
      sections.push(
        { name: 'Intro', startTimeSec: 0, endTimeSec: q1, energyLevel: avgSlice(0, 7) },
        { name: 'Build-up', startTimeSec: q1, endTimeSec: q2, energyLevel: avgSlice(7, 15) },
        { name: 'Drop', startTimeSec: q2, endTimeSec: q3, energyLevel: avgSlice(15, 31) },
        { name: 'Outro', startTimeSec: q3, endTimeSec: Number(durationSec.toFixed(2)), energyLevel: avgSlice(31, 40) }
      );
    }

    // 8. Fade in / Fade out
    const startAvg = (energyCurve[0] + energyCurve[1]) / 2;
    const midAvg = energyCurve.slice(8, 30).reduce((a, b) => a + b, 0) / 22;
    const endAvg = (energyCurve[38] + energyCurve[39]) / 2;
    const hasFadeIn = startAvg < midAvg * 0.45 && durationSec > 2;
    const hasFadeOut = endAvg < midAvg * 0.45 && durationSec > 2;
    const fadeInSec = hasFadeIn ? 0.5 : 0;
    const fadeOutSec = hasFadeOut ? 0.75 : 0;

    // 9. Real Spectral & Dynamics DSP Profile + Built-in Free Audio Effects
    const spectralProfile = computeSpectralAndDynamicsProfile(audioBuffer, mono, rmsEnv);
    const dspAudioEffects = buildDspFreeAudioEffects(
      spectralProfile,
      durationSec,
      hasFadeIn,
      hasFadeOut
    );

    return {
      analysis: {
        hasAudio: true,
        sampleRate,
        channels,
        durationSec,
        estimatedBpm,
        bpmConfidence,
        waveformPeaks: normalizedWaveform,
        energyCurve,
        beats,
        sections,
        sfxEvents: [],
        audioEffects: dspAudioEffects,
        spectralProfile,
        musicDescription: `Measured ${estimatedBpm} BPM audio (${channels}ch · ${(sampleRate / 1000).toFixed(1)} kHz · RMS ${spectralProfile.integratedRmsDb} dBFS · ${spectralProfile.reverbTailEstimate} reverb).`,
        voiceoverDetected: false,
        voiceoverNotes: 'Pending AI audio-visual correlation.',
        sourceSeparationNote:
          'Web Audio DSP analyzed 4-band spectrum, loudness dynamics, stereo width, reverb decay, beat grid, and transient peaks. All free Premiere Pro built-in audio effects are mapped directly to track filters.',
        tracks: buildDefaultTracks(true, fadeInSec, fadeOutSec),
      },
      transientTimes: transientTimes.slice(0, 18),
      hasFadeIn,
      hasFadeOut,
      spectralProfile,
      dspAudioEffects,
    };
  } catch {
    return emptyResult();
  } finally {
    if (ctx) {
      ctx.close().catch(() => {});
    }
  }
}
