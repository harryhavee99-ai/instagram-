import type {
  AudioAnalysis,
  AudioSection,
  AudioTrackMix,
  BeatMarker,
  ConfidenceLevel,
} from '../types/project';

export interface RawAudioMeasurements {
  analysis: AudioAnalysis;
  transientTimes: number[];
  hasFadeIn: boolean;
  hasFadeOut: boolean;
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
  });

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

    // Check if audio is effectively silent
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

    // 3. Onset strength function (positive first derivative of smoothed energy)
    const onset = new Float32Array(numFrames);
    for (let f = 1; f < numFrames; f++) {
      const diff = rmsEnv[f] - rmsEnv[f - 1];
      onset[f] = diff > 0 ? diff : 0;
    }

    // 4. BPM estimation via lag autocorrelation of onset envelope (70..175 BPM)
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

    // 5. Phase-align beat grid to strongest onset within first beat period
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

    // 6. Transient candidate detection (for SFX: impacts, hits, whooshes)
    const transientTimes: number[] = [];
    let meanOnset = 0;
    for (let f = 0; f < numFrames; f++) meanOnset += onset[f];
    meanOnset /= Math.max(1, numFrames);
    const threshold = Math.max(0.12, meanOnset * 2.8);

    let lastTransientSec = -0.5;
    for (let f = 2; f < numFrames - 2; f++) {
      if (
        onset[f] > threshold &&
        onset[f] >= onset[f - 1] &&
        onset[f] >= onset[f + 1]
      ) {
        const t = f * hopSec;
        if (t - lastTransientSec >= 0.35) {
          transientTimes.push(Number(t.toFixed(2)));
          lastTransientSec = t;
        }
      }
    }

    // 7. Energy curve (40 buckets) + Musical structure sections
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
        {
          name: 'Intro',
          startTimeSec: 0,
          endTimeSec: Number((durationSec * 0.35).toFixed(2)),
          energyLevel: energyCurve[4] ?? 50,
        },
        {
          name: 'Drop',
          startTimeSec: Number((durationSec * 0.35).toFixed(2)),
          endTimeSec: Number((durationSec * 0.85).toFixed(2)),
          energyLevel: Math.max(...energyCurve.slice(14, 34), 60),
        },
        {
          name: 'Outro',
          startTimeSec: Number((durationSec * 0.85).toFixed(2)),
          endTimeSec: Number(durationSec.toFixed(2)),
          energyLevel: energyCurve[38] ?? 35,
        }
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

    // 8. Fade in / Fade out detection
    const startAvg = (energyCurve[0] + energyCurve[1]) / 2;
    const midAvg = energyCurve.slice(8, 30).reduce((a, b) => a + b, 0) / 22;
    const endAvg = (energyCurve[38] + energyCurve[39]) / 2;
    const hasFadeIn = startAvg < midAvg * 0.45 && durationSec > 2;
    const hasFadeOut = endAvg < midAvg * 0.45 && durationSec > 2;
    const fadeInSec = hasFadeIn ? 0.5 : 0;
    const fadeOutSec = hasFadeOut ? 0.75 : 0;

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
        musicDescription: `Measured ${estimatedBpm} BPM audio track (${channels}ch · ${(sampleRate / 1000).toFixed(1)} kHz).`,
        voiceoverDetected: false,
        voiceoverNotes: 'Pending AI multimodal audio-visual correlation.',
        sourceSeparationNote:
          'Browser-side Web Audio DSP extracted full-mix waveform, beat grid, and transient peaks. Exact vocal/stem separation is not run locally; original mixed audio is preserved on A1 with reconstructed cue tracks on A2–A4.',
        tracks: buildDefaultTracks(true, fadeInSec, fadeOutSec),
      },
      transientTimes: transientTimes.slice(0, 18),
      hasFadeIn,
      hasFadeOut,
    };
  } catch {
    return emptyResult();
  } finally {
    if (ctx) {
      ctx.close().catch(() => {});
    }
  }
}
