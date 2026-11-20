import JSZip from 'jszip';
import type {
  AudioEffectItem,
  ColorGradeSettings,
  EffectItem,
  MotionGraphicItem,
  ReelProject,
  ShotClip,
} from '../types/project';
import { generateSrtSubtitles, hexToRgba } from './captionPresets';
import { clamp, formatSmpte, formatTimecodeMs } from './formatters';
import {
  generateMusicSectionWav,
  generateSfxWav,
  generateVoiceoverCueWav,
  splitGraphicsToCaptionLanes,
  splitSfxToAudioLanes,
} from './wavAudioGenerator';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toFrames(seconds: number, timebase: number): number {
  return Math.max(0, Math.round(seconds * timebase));
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'Reel2Premiere_Project';
}

function buildVideoEffectFilterXml(ef: EffectItem): string {
  if (!ef.includedInTimeline || ef.licenseTier !== 'Free / Built-in') return '';
  const effId = ef.premiereEffectId || 'AE.ADBE Geometry2';
  const effName = escapeXml(ef.premiereEffectName || ef.name);
  const intensity = clamp(ef.intensity, 0, 100);

  if (effId === 'Gaussian Blur' || /gaussian|blur/i.test(effId)) {
    return `
              <filter>
                <effect>
                  <name>${effName}</name>
                  <effectid>Gaussian Blur</effectid>
                  <effectcategory>Blur</effectcategory>
                  <effecttype>filter</effecttype>
                  <mediatype>video</mediatype>
                  <parameter>
                    <parameterid>radius</parameterid>
                    <name>Blurriness</name>
                    <valuemin>0</valuemin>
                    <valuemax>200</valuemax>
                    <value>${Math.round(intensity * 0.6)}</value>
                  </parameter>
                </effect>
              </filter>`;
  }

  if (/sharpen/i.test(effId)) {
    return `
              <filter>
                <effect>
                  <name>Sharpen</name>
                  <effectid>AE.ADBE Sharpen</effectid>
                  <effectcategory>Blur &amp; Sharpen</effectcategory>
                  <effecttype>filter</effecttype>
                  <mediatype>video</mediatype>
                  <parameter>
                    <parameterid>amount</parameterid>
                    <name>Sharpen Amount</name>
                    <valuemin>0</valuemin>
                    <valuemax>200</valuemax>
                    <value>${Math.round(intensity * 0.5)}</value>
                  </parameter>
                </effect>
              </filter>`;
  }

  if (/noise/i.test(effId)) {
    return `
              <filter>
                <effect>
                  <name>Noise</name>
                  <effectid>AE.ADBE Noise</effectid>
                  <effectcategory>Noise &amp; Grain</effectcategory>
                  <effecttype>filter</effecttype>
                  <mediatype>video</mediatype>
                  <parameter>
                    <parameterid>amount</parameterid>
                    <name>Amount of Noise</name>
                    <valuemin>0</valuemin>
                    <valuemax>100</valuemax>
                    <value>${Math.round(intensity * 0.3)}</value>
                  </parameter>
                </effect>
              </filter>`;
  }

  if (/brightness/i.test(effId)) {
    return `
              <filter>
                <effect>
                  <name>Brightness &amp; Contrast</name>
                  <effectid>AE.ADBE Brightness &amp; Contrast 2</effectid>
                  <effectcategory>Color Correction</effectcategory>
                  <effecttype>filter</effecttype>
                  <mediatype>video</mediatype>
                  <parameter>
                    <parameterid>brightness</parameterid>
                    <name>Brightness</name>
                    <valuemin>-150</valuemin>
                    <valuemax>150</valuemax>
                    <value>${Math.round(intensity * 0.45)}</value>
                  </parameter>
                </effect>
              </filter>`;
  }

  if (/chromatic/i.test(effId)) {
    return `
              <filter>
                <effect>
                  <name>VR Chromatic Aberrations</name>
                  <effectid>AE.ADBE VR Chromatic Aberrations</effectid>
                  <effectcategory>Immersive Video</effectcategory>
                  <effecttype>filter</effecttype>
                  <mediatype>video</mediatype>
                  <parameter>
                    <parameterid>aberrationred</parameterid>
                    <name>Aberration (Red)</name>
                    <valuemin>-20</valuemin>
                    <valuemax>20</valuemax>
                    <value>${(intensity * 0.08).toFixed(2)}</value>
                  </parameter>
                  <parameter>
                    <parameterid>aberrationblue</parameterid>
                    <name>Aberration (Blue)</name>
                    <valuemin>-20</valuemin>
                    <valuemax>20</valuemax>
                    <value>${(-intensity * 0.08).toFixed(2)}</value>
                  </parameter>
                </effect>
              </filter>`;
  }

  if (/lumetri/i.test(effId)) {
    return `
              <filter>
                <effect>
                  <name>${effName}</name>
                  <effectid>AE.ADBE Lumetri</effectid>
                  <effectcategory>Color Correction</effectcategory>
                  <effecttype>filter</effecttype>
                  <mediatype>video</mediatype>
                  <parameter>
                    <parameterid>vignetteamount</parameterid>
                    <name>Vignette Amount</name>
                    <valuemin>-5</valuemin>
                    <valuemax>5</valuemax>
                    <value>${(-intensity * 0.04).toFixed(2)}</value>
                  </parameter>
                </effect>
              </filter>`;
  }

  if (/crop/i.test(effId)) {
    return `
              <filter>
                <effect>
                  <name>Crop</name>
                  <effectid>AE.ADBE Crop</effectid>
                  <effectcategory>Transform</effectcategory>
                  <effecttype>filter</effecttype>
                  <mediatype>video</mediatype>
                  <parameter>
                    <parameterid>top</parameterid>
                    <name>Top</name>
                    <valuemin>0</valuemin>
                    <valuemax>100</valuemax>
                    <value>${Math.round(intensity * 0.12)}</value>
                  </parameter>
                  <parameter>
                    <parameterid>bottom</parameterid>
                    <name>Bottom</name>
                    <valuemin>0</valuemin>
                    <valuemax>100</valuemax>
                    <value>${Math.round(intensity * 0.12)}</value>
                  </parameter>
                </effect>
              </filter>`;
  }

  // Generic free/built-in Premiere video filter block (Transform, Tint, Mirror, Wave Warp, etc.)
  return `
              <filter>
                <effect>
                  <name>${effName}</name>
                  <effectid>${escapeXml(effId)}</effectid>
                  <effectcategory>${escapeXml(ef.category)}</effectcategory>
                  <effecttype>filter</effecttype>
                  <mediatype>video</mediatype>
                  <parameter>
                    <parameterid>amount</parameterid>
                    <name>Amount</name>
                    <valuemin>0</valuemin>
                    <valuemax>100</valuemax>
                    <value>${intensity.toFixed(1)}</value>
                  </parameter>
                </effect>
              </filter>`;
}

function buildAudioEffectFilterXml(afx: AudioEffectItem): string {
  if (!afx.includedInTimeline || afx.licenseTier !== 'Free / Built-in') return '';
  // Fade/automation is already encoded via audiolevels keyframes
  if (afx.premiereEffectId === 'audiolevels') return '';

  const effId = escapeXml(afx.premiereEffectId || 'ParametricEqualizer');
  const effName = escapeXml(afx.premiereEffectName || afx.name);
  const intensity = clamp(afx.intensity, 0, 100);

  if (afx.premiereEffectId === 'Lowpass') {
    const cutoffHz = Math.round(4500 - intensity * 30);
    return `
                <filter>
                  <effect>
                    <name>Lowpass</name>
                    <effectid>Lowpass</effectid>
                    <effectcategory>Filter and EQ</effectcategory>
                    <effecttype>filter</effecttype>
                    <mediatype>audio</mediatype>
                    <parameter>
                      <parameterid>cutoff</parameterid>
                      <name>Cutoff</name>
                      <valuemin>20</valuemin>
                      <valuemax>20000</valuemax>
                      <value>${clamp(cutoffHz, 400, 18000)}</value>
                    </parameter>
                  </effect>
                </filter>`;
  }

  if (afx.premiereEffectId === 'Highpass') {
    const cutoffHz = Math.round(60 + intensity * 3.5);
    return `
                <filter>
                  <effect>
                    <name>Highpass</name>
                    <effectid>Highpass</effectid>
                    <effectcategory>Filter and EQ</effectcategory>
                    <effecttype>filter</effecttype>
                    <mediatype>audio</mediatype>
                    <parameter>
                      <parameterid>cutoff</parameterid>
                      <name>Cutoff</name>
                      <valuemin>20</valuemin>
                      <valuemax>20000</valuemax>
                      <value>${clamp(cutoffHz, 40, 2000)}</value>
                    </parameter>
                  </effect>
                </filter>`;
  }

  if (afx.premiereEffectId === 'StudioReverb') {
    return `
                <filter>
                  <effect>
                    <name>Studio Reverb</name>
                    <effectid>StudioReverb</effectid>
                    <effectcategory>Reverb</effectcategory>
                    <effecttype>filter</effecttype>
                    <mediatype>audio</mediatype>
                    <parameter>
                      <parameterid>wet</parameterid>
                      <name>Wet Output Level</name>
                      <valuemin>0</valuemin>
                      <valuemax>100</valuemax>
                      <value>${Math.round(intensity * 0.55)}</value>
                    </parameter>
                    <parameter>
                      <parameterid>decay</parameterid>
                      <name>Decay (ms)</name>
                      <valuemin>100</valuemin>
                      <valuemax>10000</valuemax>
                      <value>${Math.round(600 + intensity * 24)}</value>
                    </parameter>
                  </effect>
                </filter>`;
  }

  if (afx.premiereEffectId === 'HardLimiter') {
    return `
                <filter>
                  <effect>
                    <name>Hard Limiter</name>
                    <effectid>HardLimiter</effectid>
                    <effectcategory>Amplitude and Compression</effectcategory>
                    <effecttype>filter</effecttype>
                    <mediatype>audio</mediatype>
                    <parameter>
                      <parameterid>maxamplitude</parameterid>
                      <name>Maximum Amplitude (dB)</name>
                      <valuemin>-20</valuemin>
                      <valuemax>0</valuemax>
                      <value>-1.0</value>
                    </parameter>
                    <parameter>
                      <parameterid>inputboost</parameterid>
                      <name>Input Boost (dB)</name>
                      <valuemin>0</valuemin>
                      <valuemax>18</valuemax>
                      <value>${(intensity * 0.06).toFixed(1)}</value>
                    </parameter>
                  </effect>
                </filter>`;
  }

  if (afx.premiereEffectId === 'SingleBandCompressor') {
    return `
                <filter>
                  <effect>
                    <name>Single-band Compressor</name>
                    <effectid>SingleBandCompressor</effectid>
                    <effectcategory>Amplitude and Compression</effectcategory>
                    <effecttype>filter</effecttype>
                    <mediatype>audio</mediatype>
                    <parameter>
                      <parameterid>threshold</parameterid>
                      <name>Threshold (dB)</name>
                      <valuemin>-60</valuemin>
                      <valuemax>0</valuemax>
                      <value>${Math.round(-10 - intensity * 0.16)}</value>
                    </parameter>
                    <parameter>
                      <parameterid>ratio</parameterid>
                      <name>Ratio</name>
                      <valuemin>1</valuemin>
                      <valuemax>20</valuemax>
                      <value>${(1.8 + intensity * 0.04).toFixed(1)}</value>
                    </parameter>
                  </effect>
                </filter>`;
  }

  return `
                <filter>
                  <effect>
                    <name>${effName}</name>
                    <effectid>${effId}</effectid>
                    <effectcategory>${escapeXml(afx.category)}</effectcategory>
                    <effecttype>filter</effecttype>
                    <mediatype>audio</mediatype>
                    <parameter>
                      <parameterid>amount</parameterid>
                      <name>Intensity</name>
                      <valuemin>0</valuemin>
                      <valuemax>100</valuemax>
                      <value>${intensity.toFixed(1)}</value>
                    </parameter>
                  </effect>
                </filter>`;
}

/**
 * Generates a valid Final Cut Pro 7 XML (XMEML v4) document
 * directly importable into Adobe Premiere Pro (File > Import).
 * Never confuses XMEML with FCPXML and never fakes a binary .prproj file.
 */
export function generatePremiereXmeml(
  project: ReelProject,
  options?: {
    timebaseOverride?: number;
    widthOverride?: number;
    heightOverride?: number;
    mediaRelativePath?: string;
  }
): string {
  const timebase = Math.round(options?.timebaseOverride || project.metadata.fps || 30);
  const width = options?.widthOverride || project.metadata.width || 1080;
  const height = options?.heightOverride || project.metadata.height || 1920;
  const totalFrames = Math.max(1, toFrames(project.metadata.durationSec, timebase));
  const sampleRate = project.audio.sampleRate || 48000;
  const channels = Math.max(1, Math.min(2, project.audio.channels || 2));
  const safeProjectName = escapeXml(project.name);
  const sourceFileName = sanitizeFileName(project.metadata.fileName || 'Source_Reel.mp4');
  const mediaPathUrl = options?.mediaRelativePath || `file://localhost/Media/${sourceFileName}`;

  const masterFileXml = `
            <file id="master-source-file-1">
              <name>${escapeXml(sourceFileName)}</name>
              <pathurl>${escapeXml(mediaPathUrl)}</pathurl>
              <rate>
                <timebase>${timebase}</timebase>
                <ntsc>FALSE</ntsc>
              </rate>
              <duration>${totalFrames}</duration>
              <media>
                <video>
                  <samplecharacteristics>
                    <rate>
                      <timebase>${timebase}</timebase>
                      <ntsc>FALSE</ntsc>
                    </rate>
                    <width>${width}</width>
                    <height>${height}</height>
                    <anamorphic>FALSE</anamorphic>
                    <pixelaspectratio>square</pixelaspectratio>
                    <fielddominance>none</fielddominance>
                  </samplecharacteristics>
                </video>
                <audio>
                  <samplecharacteristics>
                    <depth>16</depth>
                    <samplerate>${sampleRate}</samplerate>
                  </samplecharacteristics>
                  <channelcount>${channels}</channelcount>
                </audio>
              </media>
            </file>`;

  // Build Video Track 1 (Main reconstructed clips + Motion/Opacity/Speed/Blur filters + Transitions)
  const v1Items: string[] = [];
  let definedMasterFile = false;

  project.shots.forEach((shot, idx) => {
    const startF = toFrames(shot.startTimeSec, timebase);
    const endF = Math.max(startF + 1, toFrames(shot.endTimeSec, timebase));
    const inF = toFrames(shot.sourceInSec, timebase);
    const outF = Math.max(inF + 1, toFrames(shot.sourceOutSec, timebase));

    const scaleKeyframes = shot.keyframes.filter((k) => k.property === 'scale');
    const scaleKfXml = scaleKeyframes
      .map(
        (kf) => `
                  <keyframe>
                    <when>${inF + toFrames(kf.timeSec, timebase)}</when>
                    <value>${kf.value.toFixed(2)}</value>
                  </keyframe>`
      )
      .join('');

    const speedFilterXml =
      Math.abs(shot.speedPercent - 100) >= 2
        ? `
              <filter>
                <effect>
                  <name>Time Remap</name>
                  <effectid>timeremap</effectid>
                  <effectcategory>motion</effectcategory>
                  <effecttype>motion</effecttype>
                  <mediatype>video</mediatype>
                  <parameter>
                    <parameterid>variablespeed</parameterid>
                    <name>Variable Speed</name>
                    <value>FALSE</value>
                  </parameter>
                  <parameter>
                    <parameterid>speed</parameterid>
                    <name>Speed</name>
                    <valuemin>1</valuemin>
                    <valuemax>1000</valuemax>
                    <value>${shot.speedPercent.toFixed(1)}</value>
                  </parameter>
                </effect>
              </filter>`
        : '';

    // Collect ALL included Free / Built-in video effects overlapping this shot (strictly skipping Paid plugins)
    const matchingFreeEffects = project.effects.filter((ef) => {
      if (!ef.includedInTimeline || ef.licenseTier !== 'Free / Built-in') return false;
      if (ef.shotId) return ef.shotId === shot.id;
      const overlaps = ef.startTimeSec < shot.endTimeSec && ef.endTimeSec > shot.startTimeSec;
      return overlaps;
    });

    // Deduplicate identical effect IDs on a single clip
    const seenVideoFilterIds = new Set<string>();
    const freeVideoFiltersXml = matchingFreeEffects
      .filter((ef) => {
        const key = `${ef.premiereEffectId || ef.premiereEffectName}`;
        if (seenVideoFilterIds.has(key)) return false;
        seenVideoFilterIds.add(key);
        return true;
      })
      .map((ef) => buildVideoEffectFilterXml(ef))
      .join('');

    const fileRefXml = definedMasterFile
      ? `\n            <file id="master-source-file-1"/>`
      : ((definedMasterFile = true), masterFileXml);

    v1Items.push(`
          <clipitem id="v1-clip-${idx + 1}">
            <masterclipid>master-clip-1</masterclipid>
            <name>${escapeXml(shot.name)}</name>
            <enabled>TRUE</enabled>
            <duration>${totalFrames}</duration>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <start>${startF}</start>
            <end>${endF}</end>
            <in>${inF}</in>
            <out>${outF}</out>${fileRefXml}
            <filter>
              <effect>
                <name>Basic Motion</name>
                <effectid>basic</effectid>
                <effectcategory>motion</effectcategory>
                <effecttype>motion</effecttype>
                <mediatype>video</mediatype>
                <parameter>
                  <parameterid>scale</parameterid>
                  <name>Scale</name>
                  <valuemin>0</valuemin>
                  <valuemax>1000</valuemax>
                  <value>${shot.scale.toFixed(2)}</value>${scaleKfXml}
                </parameter>
                <parameter>
                  <parameterid>rotation</parameterid>
                  <name>Rotation</name>
                  <valuemin>-8640</valuemin>
                  <valuemax>8640</valuemax>
                  <value>${shot.rotation.toFixed(2)}</value>
                </parameter>
                <parameter>
                  <parameterid>center</parameterid>
                  <name>Center</name>
                  <value>
                    <horiz>${(shot.positionX / width).toFixed(4)}</horiz>
                    <vert>${(shot.positionY / height).toFixed(4)}</vert>
                  </value>
                </parameter>
              </effect>
            </filter>
            <filter>
              <effect>
                <name>Opacity</name>
                <effectid>opacity</effectid>
                <effectcategory>motion</effectcategory>
                <effecttype>motion</effecttype>
                <mediatype>video</mediatype>
                <parameter>
                  <parameterid>opacity</parameterid>
                  <name>Opacity</name>
                  <valuemin>0</valuemin>
                  <valuemax>100</valuemax>
                  <value>${shot.opacity.toFixed(1)}</value>
                </parameter>
              </effect>
            </filter>${speedFilterXml}${freeVideoFiltersXml}
            <comments>
              <mastercomment1>${escapeXml(`${shot.shotType} | ${shot.cameraMovement} | Free FX: ${seenVideoFilterIds.size} | Confidence: ${shot.confidence}`)}</mastercomment1>
            </comments>
          </clipitem>`);

    // Add supported transitionitem between adjacent shots
    if (idx < project.shots.length - 1 && shot.transitionOut.type !== 'Cut' && shot.transitionOut.durationSec > 0) {
      const halfTrans = Math.max(2, Math.round((shot.transitionOut.durationSec * timebase) / 2));
      const tStart = Math.max(startF + 1, endF - halfTrans);
      const tEnd = Math.min(totalFrames, endF + halfTrans);
      const isDip = shot.transitionOut.type === 'Flash Transition' || shot.transitionOut.type === 'Fade Out';
      const effectName = isDip ? 'Dip to Color Dissolve' : 'Cross Dissolve';
      const effectId = isDip ? 'DipToColorDissolve' : 'CrossDissolve';

      v1Items.push(`
          <transitionitem>
            <start>${tStart}</start>
            <end>${tEnd}</end>
            <alignment>center</alignment>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <effect>
              <name>${effectName}</name>
              <effectid>${effectId}</effectid>
              <effectcategory>Dissolve</effectcategory>
              <effecttype>transition</effecttype>
              <mediatype>video</mediatype>
              <wipecode>0</wipecode>
              <wipeaccuracy>100</wipeaccuracy>
              <startratio>0</startratio>
              <endratio>1</endratio>
              <reverse>FALSE</reverse>
            </effect>
          </transitionitem>`);
    }
  });

  const buildGraphicAnimationFiltersXml = (gfx: MotionGraphicItem, durF: number): string => {
    const animF = Math.max(2, Math.min(durF - 1, toFrames(gfx.animationDurationSec || 0.28, timebase)));
    const midF = Math.max(1, Math.round(animF * 0.65));
    const blocks: string[] = [];

    if (gfx.animationType === 'Bounce Pop') {
      blocks.push(`
            <filter>
              <effect>
                <name>Basic Motion</name>
                <effectid>basic</effectid>
                <effectcategory>motion</effectcategory>
                <effecttype>motion</effecttype>
                <mediatype>video</mediatype>
                <parameter>
                  <parameterid>scale</parameterid>
                  <name>Scale</name>
                  <valuemin>0</valuemin>
                  <valuemax>1000</valuemax>
                  <value>100</value>
                  <keyframe><when>0</when><value>68</value></keyframe>
                  <keyframe><when>${midF}</when><value>112</value></keyframe>
                  <keyframe><when>${animF}</when><value>100</value></keyframe>
                </parameter>
              </effect>
            </filter>`);
    } else if (
      gfx.animationType === 'Pop In' ||
      gfx.animationType === 'Kinetic Scale' ||
      gfx.animationType === 'Word Highlight' ||
      gfx.animationType === 'Karaoke Sweep'
    ) {
      blocks.push(`
            <filter>
              <effect>
                <name>Basic Motion</name>
                <effectid>basic</effectid>
                <effectcategory>motion</effectcategory>
                <effecttype>motion</effecttype>
                <mediatype>video</mediatype>
                <parameter>
                  <parameterid>scale</parameterid>
                  <name>Scale</name>
                  <valuemin>0</valuemin>
                  <valuemax>1000</valuemax>
                  <value>100</value>
                  <keyframe><when>0</when><value>82</value></keyframe>
                  <keyframe><when>${animF}</when><value>100</value></keyframe>
                </parameter>
              </effect>
            </filter>`);
    } else if (gfx.animationType === 'Slide Up') {
      blocks.push(`
            <filter>
              <effect>
                <name>Basic Motion</name>
                <effectid>basic</effectid>
                <effectcategory>motion</effectcategory>
                <effecttype>motion</effecttype>
                <mediatype>video</mediatype>
                <parameter>
                  <parameterid>center</parameterid>
                  <name>Center</name>
                  <value><horiz>0</horiz><vert>0</vert></value>
                  <keyframe><when>0</when><value><horiz>0</horiz><vert>0.035</vert></value></keyframe>
                  <keyframe><when>${animF}</when><value><horiz>0</horiz><vert>0</vert></value></keyframe>
                </parameter>
              </effect>
            </filter>`);
    }

    if (
      gfx.animationType === 'Fade' ||
      gfx.animationType === 'Slide Up' ||
      gfx.animationType === 'Glow Pulse'
    ) {
      blocks.push(`
            <filter>
              <effect>
                <name>Opacity</name>
                <effectid>opacity</effectid>
                <effectcategory>motion</effectcategory>
                <effecttype>motion</effecttype>
                <mediatype>video</mediatype>
                <parameter>
                  <parameterid>opacity</parameterid>
                  <name>opacity</name>
                  <valuemin>0</valuemin>
                  <valuemax>100</valuemax>
                  <value>100</value>
                  <keyframe><when>0</when><value>0</value></keyframe>
                  <keyframe><when>${animF}</when><value>100</value></keyframe>
                </parameter>
              </effect>
            </filter>`);
    }

    return blocks.join('');
  };

  // Build Video Tracks V3 (Primary Captions) & V4 (Secondary Captions / Titles — zero collisions)
  const graphicFileIndexMap = new Map<string, { idx: number; fileName: string }>();
  project.motionGraphics.forEach((gfx, idx) => {
    const prefix = gfx.isCaption || gfx.type === 'Caption' || gfx.type === 'Subtitle' ? 'Caption' : 'Title';
    const gfxFileName = `${prefix}_${String(idx + 1).padStart(2, '0')}_${sanitizeFileName(gfx.text).slice(0, 24)}.svg`;
    graphicFileIndexMap.set(gfx.id, { idx, fileName: gfxFileName });
  });

  const renderGraphicClipXml = (gfx: MotionGraphicItem, trackLabel: 'v3' | 'v4') => {
    const meta = graphicFileIndexMap.get(gfx.id)!;
    const startF = toFrames(gfx.startTimeSec, timebase);
    const endF = Math.max(startF + 2, toFrames(gfx.endTimeSec, timebase));
    const durF = endF - startF;
    const animFilters = buildGraphicAnimationFiltersXml(gfx, durF);

    return `
          <clipitem id="${trackLabel}-gfx-${meta.idx + 1}">
            <name>${escapeXml(gfx.text)}</name>
            <enabled>TRUE</enabled>
            <duration>${durF}</duration>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <start>${startF}</start>
            <end>${endF}</end>
            <in>0</in>
            <out>${durF}</out>
            <file id="gfx-file-${meta.idx + 1}">
              <name>${escapeXml(meta.fileName)}</name>
              <pathurl>${escapeXml(`file://localhost/Graphics/${meta.fileName}`)}</pathurl>
              <rate>
                <timebase>${timebase}</timebase>
                <ntsc>FALSE</ntsc>
              </rate>
              <duration>${durF}</duration>
              <media>
                <video>
                  <samplecharacteristics>
                    <width>${width}</width>
                    <height>${height}</height>
                  </samplecharacteristics>
                </video>
              </media>
            </file>${animFilters}
            <comments>
              <mastercomment1>${escapeXml(`${gfx.type} | Preset: ${gfx.captionStylePreset || 'Custom'} | Font: ${gfx.fontFamily} ${gfx.fontSize}px | Anim: ${gfx.animationType}${gfx.spellChecked ? ' | Spellcheck Verified' : ''}`)}</mastercomment1>
            </comments>
          </clipitem>`;
  };

  const { v3Primary, v4Secondary } = splitGraphicsToCaptionLanes(project.motionGraphics);
  const v3Items = v3Primary.map((gfx) => renderGraphicClipXml(gfx, 'v3'));
  const v4Items = v4Secondary.map((gfx) => renderGraphicClipXml(gfx, 'v4'));

  // Build Track A2: Separate Background Music / Beat Reference Sections (Audio/Music/*.wav)
  const a2Track = project.audio.tracks.find((t) => t.id === 'A2');
  const a2GainLinear = a2Track ? Math.pow(10, a2Track.volumeDb / 20) : 0.72;
  const musicSections = project.audio.sections ?? [];
  const a2Items = musicSections.map((sec, idx) => {
    const startF = toFrames(sec.startTimeSec, timebase);
    const endF = Math.max(startF + 4, toFrames(sec.endTimeSec, timebase));
    const durF = endF - startF;
    const musicFileName = `Music_${String(idx + 1).padStart(2, '0')}_${sanitizeFileName(sec.name).slice(0, 24)}.wav`;
    return `
              <clipitem id="a2-music-${idx + 1}">
                <name>${escapeXml(`Music — ${sec.name}`)}</name>
                <enabled>${a2Track?.muted ? 'FALSE' : 'TRUE'}</enabled>
                <duration>${durF}</duration>
                <rate>
                  <timebase>${timebase}</timebase>
                  <ntsc>FALSE</ntsc>
                </rate>
                <start>${startF}</start>
                <end>${endF}</end>
                <in>0</in>
                <out>${durF}</out>
                <file id="music-file-${idx + 1}">
                  <name>${escapeXml(musicFileName)}</name>
                  <pathurl>${escapeXml(`file://localhost/Audio/Music/${musicFileName}`)}</pathurl>
                  <rate>
                    <timebase>${timebase}</timebase>
                    <ntsc>FALSE</ntsc>
                  </rate>
                  <duration>${durF}</duration>
                  <media>
                    <audio>
                      <samplecharacteristics>
                        <depth>16</depth>
                        <samplerate>48000</samplerate>
                      </samplecharacteristics>
                      <channelcount>2</channelcount>
                    </audio>
                  </media>
                </file>
                <sourcetrack>
                  <mediatype>audio</mediatype>
                  <trackindex>1</trackindex>
                </sourcetrack>
                <filter>
                  <effect>
                    <name>Audio Levels</name>
                    <effectid>audiolevels</effectid>
                    <effectcategory>audiolevels</effectcategory>
                    <effecttype>audiolevels</effecttype>
                    <mediatype>audio</mediatype>
                    <parameter>
                      <parameterid>level</parameterid>
                      <name>Level</name>
                      <valuemin>0</valuemin>
                      <valuemax>3.98109</valuemax>
                      <value>${a2GainLinear.toFixed(3)}</value>
                    </parameter>
                  </effect>
                </filter>
                <comments>
                  <mastercomment1>${escapeXml(`Music Section: ${sec.name} | Energy: ${sec.energyLevel}% | ${project.audio.estimatedBpm || 120} BPM`)}</mastercomment1>
                </comments>
              </clipitem>`;
  });

  // Build Track A3 (Primary Sound Design SFX) & Track A4 (Layered / Overlapping Sound Design SFX)
  const a3Track = project.audio.tracks.find((t) => t.id === 'A3');
  const sfxIndexMap = new Map<string, { idx: number; fileName: string }>();
  (project.audio.sfxEvents ?? []).forEach((sfx, idx) => {
    const fileName = `SFX_${String(idx + 1).padStart(2, '0')}_${sanitizeFileName(sfx.category)}_${sanitizeFileName(sfx.label).slice(0, 20)}.wav`;
    sfxIndexMap.set(sfx.id, { idx, fileName });
  });

  const renderSfxClipXml = (
    sfx: (typeof project.audio.sfxEvents)[number] & { startTimeSec: number; endTimeSec: number },
    laneId: 'a3' | 'a4'
  ) => {
    const meta = sfxIndexMap.get(sfx.id)!;
    const startF = toFrames(sfx.startTimeSec, timebase);
    const endF = Math.max(startF + 3, toFrames(sfx.endTimeSec, timebase));
    const durF = endF - startF;
    const gainLin = Math.pow(10, (sfx.volumeDb ?? -2) / 20);
    return `
              <clipitem id="${laneId}-sfx-${meta.idx + 1}">
                <name>${escapeXml(`${sfx.category}: ${sfx.label}`)}</name>
                <enabled>${a3Track?.muted ? 'FALSE' : 'TRUE'}</enabled>
                <duration>${durF}</duration>
                <rate>
                  <timebase>${timebase}</timebase>
                  <ntsc>FALSE</ntsc>
                </rate>
                <start>${startF}</start>
                <end>${endF}</end>
                <in>0</in>
                <out>${durF}</out>
                <file id="sfx-file-${meta.idx + 1}">
                  <name>${escapeXml(meta.fileName)}</name>
                  <pathurl>${escapeXml(`file://localhost/Audio/SFX/${meta.fileName}`)}</pathurl>
                  <rate>
                    <timebase>${timebase}</timebase>
                    <ntsc>FALSE</ntsc>
                  </rate>
                  <duration>${durF}</duration>
                  <media>
                    <audio>
                      <samplecharacteristics>
                        <depth>16</depth>
                        <samplerate>48000</samplerate>
                      </samplecharacteristics>
                      <channelcount>2</channelcount>
                    </audio>
                  </media>
                </file>
                <sourcetrack>
                  <mediatype>audio</mediatype>
                  <trackindex>1</trackindex>
                </sourcetrack>
                <filter>
                  <effect>
                    <name>Audio Levels</name>
                    <effectid>audiolevels</effectid>
                    <effectcategory>audiolevels</effectcategory>
                    <effecttype>audiolevels</effecttype>
                    <mediatype>audio</mediatype>
                    <parameter>
                      <parameterid>level</parameterid>
                      <name>Level</name>
                      <valuemin>0</valuemin>
                      <valuemax>3.98109</valuemax>
                      <value>${gainLin.toFixed(3)}</value>
                    </parameter>
                  </effect>
                </filter>
                <comments>
                  <mastercomment1>${escapeXml(`SFX ${sfx.category} | Cue: ${sfx.linkedVisualEvent}`)}</mastercomment1>
                </comments>
              </clipitem>`;
  };

  const { a3Primary, a4Secondary } = splitSfxToAudioLanes(project.audio.sfxEvents ?? []);
  const a3Items = a3Primary.map((s) => renderSfxClipXml(s, 'a3'));
  const a4Items = a4Secondary.map((s) => renderSfxClipXml(s, 'a4'));

  // Build Track A5: Separate Voiceover / Dialogue Cue Layer
  const a4UiTrack = project.audio.tracks.find((t) => t.id === 'A4');
  const voSegments: Array<{ idx: number; label: string; startSec: number; endSec: number; fileName: string }> = [];
  if (project.audio.voiceoverDetected) {
    if (project.motionGraphics.length > 0) {
      project.motionGraphics.forEach((g, idx) => {
        const clean = sanitizeFileName(g.text).slice(0, 20);
        voSegments.push({
          idx,
          label: `VO_${String(idx + 1).padStart(2, '0')} — ${g.text.slice(0, 28)}`,
          startSec: g.startTimeSec,
          endSec: Math.max(g.startTimeSec + 0.3, g.endTimeSec),
          fileName: `VO_${String(idx + 1).padStart(2, '0')}_${clean}.wav`,
        });
      });
    } else {
      voSegments.push({
        idx: 0,
        label: 'VO_01 — Full Dialogue / Voiceover Guide',
        startSec: 0,
        endSec: project.metadata.durationSec,
        fileName: 'VO_01_Full_Dialogue_Guide.wav',
      });
    }
  }

  const a5Items = voSegments.map((seg) => {
    const startF = toFrames(seg.startSec, timebase);
    const endF = Math.max(startF + 3, toFrames(seg.endSec, timebase));
    const durF = endF - startF;
    return `
              <clipitem id="a5-vo-${seg.idx + 1}">
                <name>${escapeXml(seg.label)}</name>
                <enabled>${a4UiTrack?.muted ? 'FALSE' : 'TRUE'}</enabled>
                <duration>${durF}</duration>
                <rate>
                  <timebase>${timebase}</timebase>
                  <ntsc>FALSE</ntsc>
                </rate>
                <start>${startF}</start>
                <end>${endF}</end>
                <in>0</in>
                <out>${durF}</out>
                <file id="vo-file-${seg.idx + 1}">
                  <name>${escapeXml(seg.fileName)}</name>
                  <pathurl>${escapeXml(`file://localhost/Audio/Voiceover/${seg.fileName}`)}</pathurl>
                  <rate>
                    <timebase>${timebase}</timebase>
                    <ntsc>FALSE</ntsc>
                  </rate>
                  <duration>${durF}</duration>
                  <media>
                    <audio>
                      <samplecharacteristics>
                        <depth>16</depth>
                        <samplerate>48000</samplerate>
                      </samplecharacteristics>
                      <channelcount>2</channelcount>
                    </audio>
                  </media>
                </file>
                <sourcetrack>
                  <mediatype>audio</mediatype>
                  <trackindex>1</trackindex>
                </sourcetrack>
              </clipitem>`;
  });

  // Build Adobe Premiere Pro Project Panel Bins (Separated Clips, Caption Layers, Sound Design Stems)
  const separatedClipBinItems = project.shots
    .map((shot, idx) => {
      const inF = toFrames(shot.startTimeSec, timebase);
      const outF = Math.max(inF + 2, toFrames(shot.endTimeSec, timebase));
      const durF = outF - inF;
      return `
          <clip id="subclip-${idx + 1}">
            <name>${escapeXml(`Clip_${String(idx + 1).padStart(2, '0')}_${shot.name}`)}</name>
            <duration>${durF}</duration>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <in>${inF}</in>
            <out>${outF}</out>
            <masterclipid>master-clip-1</masterclipid>
            <issubclip>TRUE</issubclip>
            <subclipinfo>
              <startoffset>${inF}</startoffset>
              <endoffset>${Math.max(0, totalFrames - outF)}</endoffset>
            </subclipinfo>
            <file id="master-source-file-1"/>
            <comments>
              <mastercomment1>${escapeXml(`${shot.shotType} | ${shot.cameraMovement} | ${shot.speedPercent}% | Out: ${shot.transitionOut.type}`)}</mastercomment1>
            </comments>
          </clip>`;
    })
    .join('');

  const captionBinItems = project.motionGraphics
    .map((gfx, idx) => {
      const meta = graphicFileIndexMap.get(gfx.id)!;
      const durF = Math.max(2, toFrames(gfx.endTimeSec - gfx.startTimeSec, timebase));
      return `
          <clip id="bin-gfx-${idx + 1}">
            <name>${escapeXml(meta.fileName)}</name>
            <duration>${durF}</duration>
            <rate>
              <timebase>${timebase}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <file id="gfx-file-${idx + 1}"/>
          </clip>`;
    })
    .join('');

  const soundDesignBinItems = [
    ...musicSections.map((sec, idx) => `
          <clip id="bin-music-${idx + 1}">
            <name>${escapeXml(`Music_${String(idx + 1).padStart(2, '0')}_${sec.name}`)}</name>
            <duration>${Math.max(4, toFrames(sec.endTimeSec - sec.startTimeSec, timebase))}</duration>
            <rate><timebase>${timebase}</timebase><ntsc>FALSE</ntsc></rate>
            <file id="music-file-${idx + 1}"/>
          </clip>`),
    ...(project.audio.sfxEvents ?? []).map((sfx, idx) => `
          <clip id="bin-sfx-${idx + 1}">
            <name>${escapeXml(`SFX_${String(idx + 1).padStart(2, '0')}_${sfx.category}_${sfx.label}`)}</name>
            <duration>${Math.max(3, toFrames(sfx.durationSec || 0.35, timebase))}</duration>
            <rate><timebase>${timebase}</timebase><ntsc>FALSE</ntsc></rate>
            <file id="sfx-file-${idx + 1}"/>
          </clip>`),
    ...voSegments.map((seg) => `
          <clip id="bin-vo-${seg.idx + 1}">
            <name>${escapeXml(seg.label)}</name>
            <duration>${Math.max(3, toFrames(seg.endSec - seg.startSec, timebase))}</duration>
            <rate><timebase>${timebase}</timebase><ntsc>FALSE</ntsc></rate>
            <file id="vo-file-${seg.idx + 1}"/>
          </clip>`),
  ].join('');

  // Sequence beat + shot markers for Premiere Pro timeline
  const markersXml: string[] = [];
  project.audio.beats.forEach((beat) => {
    const f = toFrames(beat.timeSec, timebase);
    markersXml.push(`
      <marker>
        <name>${beat.isDownbeat ? `Bar ${beat.barNumber} Downbeat` : `Beat ${beat.barNumber}.${beat.beatInBar}`}</name>
        <comment>${beat.syncedShotId ? `Synced cut: ${beat.syncedShotId}` : `Detected musical beat (${project.audio.estimatedBpm} BPM)`}</comment>
        <in>${f}</in>
        <out>-1</out>
      </marker>`);
  });

  project.audio.sfxEvents.forEach((sfx) => {
    const f = toFrames(sfx.timeSec, timebase);
    markersXml.push(`
      <marker>
        <name>${escapeXml(`SFX: ${sfx.label}`)}</name>
        <comment>${escapeXml(`${sfx.category} — ${sfx.linkedVisualEvent}`)}</comment>
        <in>${f}</in>
        <out>-1</out>
      </marker>`);
  });

  // Add markers for timed Free / Built-in Audio Effects
  (project.audio.audioEffects ?? [])
    .filter((afx) => afx.includedInTimeline && afx.licenseTier === 'Free / Built-in')
    .forEach((afx) => {
      if (afx.startTimeSec > 0.25 || afx.endTimeSec < project.metadata.durationSec - 0.5) {
        const f = toFrames(afx.startTimeSec, timebase);
        markersXml.push(`
      <marker>
        <name>${escapeXml(`Audio FX: ${afx.premiereEffectName}`)}</name>
        <comment>${escapeXml(`${afx.name} (${afx.category}) — ${afx.notes}`)}</comment>
        <in>${f}</in>
        <out>-1</out>
      </marker>`);
      }
    });

  const a1Track = project.audio.tracks.find((t) => t.id === 'A1');
  const a1GainLinear = a1Track ? Math.pow(10, a1Track.volumeDb / 20) : 1;
  const fadeInFrames = a1Track ? toFrames(a1Track.fadeInSec, timebase) : 0;
  const fadeOutFrames = a1Track ? toFrames(a1Track.fadeOutSec, timebase) : 0;

  const audioFadeKeyframes: string[] = [];
  if (fadeInFrames > 0) {
    audioFadeKeyframes.push(
      `\n                    <keyframe><when>0</when><value>0.000</value></keyframe>`,
      `\n                    <keyframe><when>${fadeInFrames}</when><value>${a1GainLinear.toFixed(3)}</value></keyframe>`
    );
  }
  if (fadeOutFrames > 0 && totalFrames > fadeOutFrames) {
    audioFadeKeyframes.push(
      `\n                    <keyframe><when>${totalFrames - fadeOutFrames}</when><value>${a1GainLinear.toFixed(3)}</value></keyframe>`,
      `\n                    <keyframe><when>${totalFrames}</when><value>0.000</value></keyframe>`
    );
  }

  // Embed ALL included Free / Built-in Premiere Audio Effects onto Track A1 (strictly skipping Paid plugins)
  const seenAudioFilterIds = new Set<string>();
  const freeAudioFiltersXml = (project.audio.audioEffects ?? [])
    .filter((afx) => {
      if (!afx.includedInTimeline || afx.licenseTier !== 'Free / Built-in') return false;
      if (afx.premiereEffectId === 'audiolevels') return false;
      if (seenAudioFilterIds.has(afx.premiereEffectId)) return false;
      seenAudioFilterIds.add(afx.premiereEffectId);
      return true;
    })
    .map((afx) => buildAudioEffectFilterXml(afx))
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <project>
    <name>${safeProjectName}</name>
    <children>
      <bin>
        <name>01_Separated_Clips</name>
        <children>${separatedClipBinItems}
        </children>
      </bin>
      <bin>
        <name>02_Caption_Layers</name>
        <children>${captionBinItems}
        </children>
      </bin>
      <bin>
        <name>03_Sound_Design_Layers</name>
        <children>${soundDesignBinItems}
        </children>
      </bin>
      <sequence id="reel2premiere-seq-1">
        <name>${safeProjectName}_Reconstructed</name>
        <duration>${totalFrames}</duration>
        <rate>
          <timebase>${timebase}</timebase>
          <ntsc>FALSE</ntsc>
        </rate>
        <timecode>
          <rate>
            <timebase>${timebase}</timebase>
            <ntsc>FALSE</ntsc>
          </rate>
          <string>00:00:00:00</string>
          <frame>0</frame>
          <displayformat>NDF</displayformat>
        </timecode>
        <media>
          <video>
            <format>
              <samplecharacteristics>
                <rate>
                  <timebase>${timebase}</timebase>
                  <ntsc>FALSE</ntsc>
                </rate>
                <width>${width}</width>
                <height>${height}</height>
                <anamorphic>FALSE</anamorphic>
                <pixelaspectratio>square</pixelaspectratio>
                <fielddominance>none</fielddominance>
                <colordepth>24</colordepth>
              </samplecharacteristics>
            </format>
            <track>
              <!-- V1: Separated Video Clips (Individual Cuts + Transitions + Free Video FX) -->${v1Items.join('')}
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- V2: Color Adjustment Layer / LUT Reference Track -->
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- V3: Captions Layer — Primary (Styled & Animated SVG Plates) -->${v3Items.join('')}
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- V4: Captions & Titles Layer — Secondary (Non-Overlapping Overflow) -->${v4Items.join('')}
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
          </video>
          <audio>
            <numOutputChannels>${channels}</numOutputChannels>
            <format>
              <samplecharacteristics>
                <depth>16</depth>
                <samplerate>${sampleRate}</samplerate>
              </samplecharacteristics>
            </format>
            <track>
              <!-- A1: Original Authorized Source Audio + Free Audio FX -->
              <clipitem id="a1-original-audio">
                <masterclipid>master-clip-1</masterclipid>
                <name>${escapeXml(sourceFileName)} (Audio)</name>
                <enabled>${a1Track?.muted ? 'FALSE' : 'TRUE'}</enabled>
                <duration>${totalFrames}</duration>
                <rate>
                  <timebase>${timebase}</timebase>
                  <ntsc>FALSE</ntsc>
                </rate>
                <start>0</start>
                <end>${totalFrames}</end>
                <in>0</in>
                <out>${totalFrames}</out>
                <file id="master-source-file-1"/>
                <sourcetrack>
                  <mediatype>audio</mediatype>
                  <trackindex>1</trackindex>
                </sourcetrack>
                <filter>
                  <effect>
                    <name>Audio Levels</name>
                    <effectid>audiolevels</effectid>
                    <effectcategory>audiolevels</effectcategory>
                    <effecttype>audiolevels</effecttype>
                    <mediatype>audio</mediatype>
                    <parameter>
                      <parameterid>level</parameterid>
                      <name>Level</name>
                      <valuemin>0</valuemin>
                      <valuemax>3.98109</valuemax>
                      <value>${a1GainLinear.toFixed(3)}</value>${audioFadeKeyframes.join('')}
                    </parameter>
                  </effect>
                </filter>${freeAudioFiltersXml}
              </clipitem>
              <enabled>${a1Track?.muted ? 'FALSE' : 'TRUE'}</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- A2: Background Music / Beat Reference Sections (Audio/Music/*.wav) -->${a2Items.join('')}
              <enabled>${a2Track?.muted ? 'FALSE' : 'TRUE'}</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- A3: Sound Design SFX Layer — Primary (Whoosh, Impact, Riser, Drop, Click) -->${a3Items.join('')}
              <enabled>${a3Track?.muted ? 'FALSE' : 'TRUE'}</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- A4: Sound Design SFX Layer — Layered / Secondary Hits -->${a4Items.join('')}
              <enabled>${a3Track?.muted ? 'FALSE' : 'TRUE'}</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- A5: Voiceover / Dialogue Layer (Aligned to Speech & Caption Cues) -->${a5Items.join('')}
              <enabled>${a4UiTrack?.muted ? 'FALSE' : 'TRUE'}</enabled>
              <locked>FALSE</locked>
            </track>
          </audio>
        </media>${markersXml.join('')}
      </sequence>
    </children>
  </project>
</xmeml>
`;
}

/**
 * Generates a standard CMX 3600 Edit Decision List (.edl) listing every separated clip.
 */
export function generateSeparatedClipsEdl(project: ReelProject): string {
  const fps = Math.max(15, Math.round(project.metadata.fps || 30));
  const lines: string[] = [
    `TITLE: ${project.name.toUpperCase()} - SEPARATED CLIPS`,
    `FCM: NON-DROP FRAME`,
    ``,
  ];

  project.shots.forEach((shot, idx) => {
    const editNum = String(idx + 1).padStart(3, '0');
    const tcIn = formatSmpte(shot.startTimeSec, fps);
    const tcOut = formatSmpte(shot.endTimeSec, fps);
    const transCode = shot.transitionOut.type === 'Cut' ? 'C   ' : 'D   ';
    lines.push(
      `${editNum}  CLIP${String(idx + 1).padStart(2, '0')}   V     ${transCode}        ${tcIn} ${tcOut} ${tcIn} ${tcOut}`,
      `* FROM CLIP NAME: Clip_${String(idx + 1).padStart(2, '0')}_${shot.name}`,
      `* COMMENT: ${shot.shotType} | ${shot.cameraMovement} | Speed ${shot.speedPercent}% | Out: ${shot.transitionOut.type}`,
      ``
    );
  });

  return lines.join('\n');
}

/**
 * Generates a clean CSV cut sheet of all separated clips for editors and assistants.
 */
export function generateSeparatedClipsCsv(project: ReelProject): string {
  const header = 'Clip Number,Clip Name,Section,Shot Type,Start (s),End (s),Duration (s),Camera Movement,Speed (%),Transition Out,Beat Synced';
  const rows = project.shots.map((s, idx) =>
    [
      `Clip_${String(idx + 1).padStart(2, '0')}`,
      `"${s.name.replace(/"/g, '""')}"`,
      `"${s.section}"`,
      `"${s.shotType}"`,
      s.startTimeSec.toFixed(3),
      s.endTimeSec.toFixed(3),
      s.durationSec.toFixed(3),
      `"${s.cameraMovement.replace(/"/g, '""')}"`,
      s.speedPercent,
      `"${s.transitionOut.type}"`,
      s.beatAligned ? 'Yes' : 'No',
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * Generates a standalone single-clip Premiere Pro XMEML subclip file so every
 * individual clip can also be imported separately if desired.
 */
export function generateStandaloneSubclipXml(
  project: ReelProject,
  shot: ShotClip,
  idx: number,
  options?: { timebaseOverride?: number; widthOverride?: number; heightOverride?: number }
): string {
  const timebase = Math.max(15, Math.round(options?.timebaseOverride || project.metadata.fps || 30));
  const width = options?.widthOverride || project.metadata.width || 1080;
  const height = options?.heightOverride || project.metadata.height || 1920;
  const sourceFileName = sanitizeFileName(project.metadata.fileName || 'Source_Reel.mp4');
  const inF = toFrames(shot.startTimeSec, timebase);
  const outF = Math.max(inF + 2, toFrames(shot.endTimeSec, timebase));
  const durF = outF - inF;
  const totalFrames = Math.max(outF, toFrames(project.metadata.durationSec, timebase));

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="subclip-seq-${idx + 1}">
    <name>${escapeXml(`Clip_${String(idx + 1).padStart(2, '0')}_${shot.name}`)}</name>
    <duration>${durF}</duration>
    <rate><timebase>${timebase}</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <rate><timebase>${timebase}</timebase><ntsc>FALSE</ntsc></rate>
            <width>${width}</width>
            <height>${height}</height>
          </samplecharacteristics>
        </format>
        <track>
          <clipitem id="solo-clip-${idx + 1}">
            <name>${escapeXml(`Clip_${String(idx + 1).padStart(2, '0')}_${shot.name}`)}</name>
            <enabled>TRUE</enabled>
            <duration>${totalFrames}</duration>
            <rate><timebase>${timebase}</timebase><ntsc>FALSE</ntsc></rate>
            <start>0</start>
            <end>${durF}</end>
            <in>${inF}</in>
            <out>${outF}</out>
            <file id="solo-source-file-${idx + 1}">
              <name>${escapeXml(sourceFileName)}</name>
              <pathurl>${escapeXml(`file://localhost/Media/${sourceFileName}`)}</pathurl>
              <rate><timebase>${timebase}</timebase><ntsc>FALSE</ntsc></rate>
              <duration>${totalFrames}</duration>
              <media>
                <video>
                  <samplecharacteristics>
                    <width>${width}</width>
                    <height>${height}</height>
                  </samplecharacteristics>
                </video>
              </media>
            </file>
          </clipitem>
        </track>
      </video>
    </media>
  </sequence>
</xmeml>`;
}

/**
 * Generates a real 17x17x17 Iridas / Adobe Premiere Pro compatible .cube 3D LUT
 * approximating the reconstructed Lumetri color grading settings.
 */
export function generateCubeLut(grade: ColorGradeSettings, projectName: string): string {
  const size = 17;
  const lines: string[] = [
    `# Generated by Reel2Premiere AI`,
    `# Reconstructed Color Profile: ${grade.profileName}`,
    `# Confidence: ${grade.confidence} (${grade.confidenceScore}%)`,
    `TITLE "${projectName.replace(/"/g, '')} - ${grade.profileName}"`,
    `LUT_3D_SIZE ${size}`,
    `DOMAIN_MIN 0.0 0.0 0.0`,
    `DOMAIN_MAX 1.0 1.0 1.0`,
    ``,
  ];

  const expMult = Math.pow(2, grade.exposure * 0.45);
  const contrastSlope = 1 + grade.contrast * 0.0085;
  const satMult = grade.saturation / 100;
  const tempShift = grade.temperature * 0.0014;
  const tintShift = grade.tint * 0.0012;
  const fadeLift = grade.fade * 0.0018;
  const blacksAdj = grade.blacks * 0.0012;
  const whitesAdj = grade.whites * 0.0012;

  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        let r = ri / (size - 1);
        let g = gi / (size - 1);
        let b = bi / (size - 1);

        // Exposure
        r *= expMult;
        g *= expMult;
        b *= expMult;

        // Temperature & tint
        r += tempShift + tintShift * 0.5;
        g -= tintShift * 0.5;
        b -= tempShift - tintShift * 0.5;

        // RGB Curve gains/lifts
        r = r * grade.rgbCurves.redGain + grade.rgbCurves.redLift * 0.35;
        g = g * grade.rgbCurves.greenGain + grade.rgbCurves.greenLift * 0.35;
        b = b * grade.rgbCurves.blueGain + grade.rgbCurves.blueLift * 0.35;

        // Contrast pivot at 0.5
        r = (r - 0.5) * contrastSlope + 0.5;
        g = (g - 0.5) * contrastSlope + 0.5;
        b = (b - 0.5) * contrastSlope + 0.5;

        // Blacks / Whites / Fade lift
        r = r * (1 + whitesAdj - blacksAdj) + blacksAdj + fadeLift;
        g = g * (1 + whitesAdj - blacksAdj) + blacksAdj + fadeLift;
        b = b * (1 + whitesAdj - blacksAdj) + blacksAdj + fadeLift;

        // Saturation
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma + (r - luma) * satMult;
        g = luma + (g - luma) * satMult;
        b = luma + (b - luma) * satMult;

        lines.push(
          `${clamp(r, 0, 1).toFixed(6)} ${clamp(g, 0, 1).toFixed(6)} ${clamp(b, 0, 1).toFixed(6)}`
        );
      }
    }
  }

  return lines.join('\n');
}

export function generateGraphicSvgPlate(
  gfx: MotionGraphicItem,
  width: number,
  height: number
): string {
  const x = Math.round((gfx.positionXPercent / 100) * width);
  const y = Math.round((gfx.positionYPercent / 100) * height);
  const scaleFactor = width / 540;
  const scaledSize = Math.round(gfx.fontSize * scaleFactor);
  const strokeWidth = Math.max(0, Number(((gfx.outlineWidthPx ?? 2) * scaleFactor * 0.75).toFixed(1)));

  const rawText = gfx.text.replace(/\s+/g, ' ').trim();
  const displayText =
    gfx.textTransform === 'uppercase'
      ? rawText.toUpperCase()
      : gfx.textTransform === 'capitalize'
      ? rawText.replace(/\b\w/g, (c) => c.toUpperCase())
      : rawText;

  const isNeon = gfx.captionStylePreset === 'Neon Glow' || gfx.animationType === 'Glow Pulse';
  const filterAttr = isNeon
    ? 'filter="url(#neonGlow)"'
    : gfx.hasShadow
    ? 'filter="url(#dropShadow)"'
    : '';

  const bgOpacity = gfx.backgroundOpacity ?? 0;
  const estBoxWidth = Math.min(
    Math.round(width * 0.88),
    Math.max(Math.round(scaledSize * 3), Math.round(displayText.length * scaledSize * 0.62 + scaledSize * 1.1))
  );
  const estBoxHeight = Math.round(scaledSize * 1.55);
  const bgRect =
    bgOpacity > 0
      ? `\n  <rect x="${Math.round(x - estBoxWidth / 2)}" y="${Math.round(y - estBoxHeight / 2)}" width="${estBoxWidth}" height="${estBoxHeight}" rx="${Math.round(scaledSize * 0.35)}" fill="${escapeXml(hexToRgba(gfx.backgroundColorHex || '#000000', bgOpacity))}" />`
      : '';

  // Highlight keyword via <tspan> if present
  let innerTextXml = escapeXml(displayText);
  const hlWord = gfx.highlightWord?.trim();
  if (hlWord && gfx.highlightColorHex) {
    const tokens = displayText.split(/(\s+)/);
    const normHl = hlWord.toLowerCase().replace(/[^a-z0-9]/gi, '');
    innerTextXml = tokens
      .map((tok) => {
        const cleanTok = tok.toLowerCase().replace(/[^a-z0-9]/gi, '');
        if (normHl && cleanTok === normHl) {
          return `<tspan fill="${escapeXml(gfx.highlightColorHex!)}">${escapeXml(tok)}</tspan>`;
        }
        return escapeXml(tok);
      })
      .join('');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.7"/>
    </filter>
    <filter id="neonGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="${escapeXml(gfx.outlineColorHex || '#7C5CFF')}" flood-opacity="0.95"/>
      <feDropShadow dx="0" dy="0" stdDeviation="24" flood-color="${escapeXml(gfx.highlightColorHex || '#38BDF8')}" flood-opacity="0.65"/>
    </filter>
  </defs>${bgRect}
  <text
    x="${x}"
    y="${y}"
    text-anchor="middle"
    dominant-baseline="middle"
    font-family="${escapeXml(gfx.fontFamily)}, sans-serif"
    font-size="${scaledSize}"
    font-weight="${gfx.fontWeight}"
    fill="${escapeXml(gfx.colorHex)}"
    stroke="${escapeXml(gfx.outlineColorHex)}"
    stroke-width="${strokeWidth}"
    stroke-linejoin="round"
    paint-order="stroke"
    ${filterAttr}
  >${innerTextXml}</text>
</svg>`;
}

export function generateReconstructionReportMarkdown(project: ReelProject): string {
  const lines: string[] = [
    `# Reel2Premiere AI — Reconstruction & Compatibility Report`,
    ``,
    `- **Project**: ${project.name}`,
    `- **Generated**: ${new Date().toISOString()}`,
    `- **Source File**: ${project.metadata.fileName} (${project.metadata.width}×${project.metadata.height}, ${project.metadata.aspectRatio}, ${project.metadata.fps} fps, ${formatTimecodeMs(project.metadata.durationSec)})`,
    `- **Editing Style**: ${project.summary.styleLabel} (${project.summary.pacingLabel})`,
    `- **Detected BPM**: ${project.audio.hasAudio ? `${project.audio.estimatedBpm} BPM (${project.audio.bpmConfidence} confidence)` : 'No audio detected'}`,
    `- **Estimated Color Profile**: ${project.colorGrade.profileName} (${project.colorGrade.confidence} confidence — ${project.colorGrade.confidenceScore}%)`,
    ``,
    `## Shot-by-Shot Breakdown`,
    ``,
  ];

  for (const s of project.shots) {
    lines.push(
      `### SHOT ${String(s.index + 1).padStart(2, '0')} — ${s.name}`,
      `- Start: \`${formatTimecodeMs(s.startTimeSec)}\` | End: \`${formatTimecodeMs(s.endTimeSec)}\` | Duration: ${s.durationSec.toFixed(2)}s`,
      `- Framing: ${s.shotType} (${s.section}) | Subject: ${s.subjectPosition}`,
      `- Camera Movement: ${s.cameraMovement} | Speed: ${s.speedPercent}% (${s.speedRampProfile})`,
      `- Motion Transform: Scale ${s.scale}%, Pos (${s.positionX}, ${s.positionY}), Rot ${s.rotation}°`,
      `- Outgoing Transition: ${s.transitionOut.type} (${s.transitionOut.durationSec}s) — Premiere Support: **${s.transitionOut.premiereSupport}** (${s.transitionOut.premiereMapping})`,
      `- Beat Sync: ${s.beatAligned ? `Aligned to beat at ${formatTimecodeMs(s.alignedBeatTimeSec || s.startTimeSec)}` : 'Free cut'}`,
      `- Confidence: **${s.confidence}**`,
      ``
    );
  }

  const includedFreeVideoFx = project.effects.filter(
    (e) => e.includedInTimeline && e.licenseTier === 'Free / Built-in'
  );
  const skippedPaidVideoFx = project.effects.filter((e) => e.licenseTier === 'Paid / Third-Party');
  const includedFreeAudioFx = (project.audio.audioEffects ?? []).filter(
    (e) => e.includedInTimeline && e.licenseTier === 'Free / Built-in'
  );
  const skippedPaidAudioFx = (project.audio.audioEffects ?? []).filter(
    (e) => e.licenseTier === 'Paid / Third-Party'
  );

  lines.push(
    `## Included Free / Built-in Video Effects (${includedFreeVideoFx.length})`,
    ``,
    ...(includedFreeVideoFx.length
      ? includedFreeVideoFx.map(
          (ef) =>
            `- **${ef.name}** → \`${ef.premiereEffectName}\` (${formatTimecodeMs(ef.startTimeSec)}–${formatTimecodeMs(ef.endTimeSec)}, Intensity ${ef.intensity}%)`
        )
      : ['- Standard Basic Motion & Opacity only']),
    ``,
    `## Included Free / Built-in Audio Effects (${includedFreeAudioFx.length})`,
    ``,
    ...(includedFreeAudioFx.length
      ? includedFreeAudioFx.map(
          (afx) =>
            `- **${afx.name}** → \`${afx.premiereEffectName}\` on Track ${afx.trackId} (Intensity ${afx.intensity}%, Source: ${afx.detectionSource || 'Web Audio DSP'})`
        )
      : ['- Standard Audio Levels & Fades only']),
    ``
  );

  if (project.audio.spectralProfile) {
    const sp = project.audio.spectralProfile;
    lines.push(
      `## Audio Spectral & Dynamics Telemetry`,
      ``,
      `- Sub-Bass: ${sp.subBassEnergy}% | Bass: ${sp.bassEnergy}% | Mid: ${sp.midEnergy}% | High: ${sp.highEnergy}%`,
      `- Integrated RMS: ${sp.integratedRmsDb} dBFS | Peak: ${sp.peakDb} dBFS | Dynamic Range: ${sp.dynamicRangeDb} dB`,
      `- Stereo Width: ${sp.stereoWidthPercent}% | Reverb Tail: ${sp.reverbTailEstimate} | Low-Pass Filter: ${sp.lowPassFilterDetected ? 'Detected' : 'None'} | Ducking/Compression: ${sp.sidechainOrDuckingDetected ? 'Detected' : 'None'}`,
      ``
    );
  }

  if (skippedPaidVideoFx.length > 0 || skippedPaidAudioFx.length > 0) {
    lines.push(
      `## Skipped Paid / Third-Party Plugins (${skippedPaidVideoFx.length + skippedPaidAudioFx.length})`,
      ``,
      `These paid third-party plugins were detected and cleanly bypassed so processing completed with Free / Built-in Premiere Pro effects:`,
      ...skippedPaidVideoFx.map(
        (ef) => `- [Video] **${ef.name}** (${ef.pluginVendor || 'Third-Party'}) — ${ef.skippedReason || 'Bypassed'}`
      ),
      ...skippedPaidAudioFx.map(
        (afx) => `- [Audio] **${afx.name}** (${afx.pluginVendor || 'Third-Party'}) — ${afx.skippedReason || 'Bypassed'}`
      ),
      ``
    );
  }

  if (project.motionGraphics.length > 0) {
    lines.push(
      `## Reconstructed Captions & Motion Graphics (${project.motionGraphics.length})`,
      ``,
      ...project.motionGraphics.map(
        (g, i) =>
          `- **#${i + 1} [${formatTimecodeMs(g.startTimeSec)} – ${formatTimecodeMs(g.endTimeSec)}]** "${g.text}" — Style: \`${g.captionStylePreset || 'Custom'}\` | Animation: \`${g.animationType}\`${g.highlightWord ? ` | Highlight: "${g.highlightWord}" (${g.highlightColorHex})` : ''}${g.spellChecked ? ' | Spellcheck Verified' : ''}`
      ),
      ``
    );
  }

  if (project.skippedStages && project.skippedStages.length > 0) {
    lines.push(
      `## Partial / Skipped Pipeline Stages`,
      ``,
      `The project completed and packaged cleanly even though the following stages had partial data:`,
      ...project.skippedStages.map((sk) => `- **Stage ${sk.stageId} (${sk.label})**: ${sk.reason}`),
      ``
    );
  }

  lines.push(
    `## Premiere Pro Compatibility Summary (${project.compatibility.nativeCoveragePercent}% Native Coverage)`,
    ``,
    `### Fully Reconstructed`,
    ...project.compatibility.fullyReconstructed.map((x) => `- ${x}`),
    ``,
    `### Approximate Reconstructions`,
    ...project.compatibility.approximate.map((x) => `- ${x}`),
    ``,
    `### Unsupported / Skipped Paid Effects`,
    ...(project.compatibility.unsupported.length
      ? project.compatibility.unsupported.map((x) => `- ${x}`)
      : ['- None detected']),
    ``,
    `### Missing Assets & Required Manual Adjustments`,
    ...project.compatibility.missingAssets.map((x) => `- [Asset] ${x}`),
    ...project.compatibility.manualAdjustments.map((x) => `- [Action] ${x}`),
    ``
  );

  return lines.join('\n');
}

export function generateRelinkingGuide(project: ReelProject): string {
  const sourceFileName = sanitizeFileName(project.metadata.fileName || 'Source_Reel.mp4');
  return `REEL2PREMIERE AI — ADOBE PREMIERE PRO IMPORT & RELINKING GUIDE
================================================================

Project: ${project.name}
Format: Final Cut Pro 7 XML Interchange (XMEML v4)
Sequence: ${project.metadata.width}x${project.metadata.height} @ ${project.metadata.fps} fps (${project.metadata.aspectRatio})

1. EXTRACT THIS PACKAGE
   Unzip the entire folder to your local editing drive before opening Adobe Premiere Pro.
   Keep the relative folder structure intact:
   - Project/${sanitizeFileName(project.name)}_Premiere.xml
   - Media/${sourceFileName}
   - Clips/ (Separated individual Clip_01..xml subclips, CMX 3600 .edl, CSV cut sheet, Keyframes)
   - Graphics/ (Styled transparent vector Caption_*.svg & Title_*.svg plates)
   - Captions/${sanitizeFileName(project.name)}_Captions.srt
   - Audio/Music/ (Tempo-synced Music section .wav stems for Track A2)
   - Audio/SFX/ (Individual Sound Design Whoosh/Impact/Riser/Drop .wav stems for Tracks A3 & A4)
   - Audio/Voiceover/ (Aligned Voiceover/Dialogue cue .wav stems for Track A5)
   - LUTs/Reconstructed_Look.cube
   - Manifests/ & Reports/

2. IMPORT INTO ADOBE PREMIERE PRO
   - Open Adobe Premiere Pro and create or open a project.
   - Go to File > Import... (Ctrl+I / Cmd+I).
   - Select: Project/${sanitizeFileName(project.name)}_Premiere.xml
   - In the Project Panel, you will see 3 organized bins plus the master sequence:
     • 01_Separated_Clips (every shot clip separated individually)
     • 02_Caption_Layers (every caption SVG graphic layer)
     • 03_Sound_Design_Layers (every Music, SFX & Voiceover .wav layer)
   - Double-click "${project.name}_Reconstructed" to open the full multitrack timeline.

3. RELINK MEDIA (IF PROMPTED)
   - If Premiere Pro opens the "Link Media" dialog for ${sourceFileName}:
     Click "Locate...", navigate to Media/${sourceFileName} (or your local original MP4), and click OK.
   - All Graphics/Caption_*.svg and Audio/**/*.wav stems live inside this extracted ZIP folder.

4. EDITABLE CAPTIONS (TRACK V3 / V4 + .SRT)
   - Styled & keyframe-animated caption plates are placed on Track V3 (and Track V4 if layered).
   - For native Premiere Pro Text Panel / Essential Graphics captions, import
     Captions/${sanitizeFileName(project.name)}_Captions.srt via File > Import... and drag it
     onto the sequence Captions track.

5. APPLY THE RECONSTRUCTED COLOR GRADE (.cube LUT)
   - Add an Adjustment Layer on Track V2 spanning the sequence (or select clips on V1).
   - Open Window > Lumetri Color > Creative (or Basic Correction > Input LUT).
   - Browse and select: LUTs/Reconstructed_Look.cube

6. SEPARATED SOUND DESIGN LAYERS (TRACKS A1 – A5)
   - Track A1: Original source audio + Free / Built-in Premiere audio effects.
   - Track A2: Background Music / Beat Reference sections (Audio/Music/*.wav).
   - Track A3: Primary Sound Design SFX clips — Whoosh, Impact, Riser, Drop, Click (Audio/SFX/*.wav).
   - Track A4: Layered / Secondary Sound Design SFX hits (non-overlapping overflow).
   - Track A5: Voiceover / Dialogue guide segments aligned to speech/caption cues (Audio/Voiceover/*.wav).
   - Sequence markers on the timeline ruler mark every detected beat (${project.audio.estimatedBpm || 'N/A'} BPM) and SFX cue.

7. REVIEW COMPATIBILITY REPORT
   - Open Reports/Reconstruction_Report.md for a full shot-by-shot breakdown.
`;
}

export async function buildPremiereZipBlob(
  project: ReelProject,
  options: {
    sourceFile?: File | null;
    includeSourceMedia: boolean;
    includeCubeLut: boolean;
    timebaseOverride?: number;
    widthOverride?: number;
    heightOverride?: number;
  }
): Promise<{ blob: Blob; fileName: string; xmlText: string; lutText: string }> {
  const zip = new JSZip();
  const safeBase = sanitizeFileName(project.name);
  const sourceFileName = sanitizeFileName(project.metadata.fileName || 'Source_Reel.mp4');

  const xmlText = generatePremiereXmeml(project, {
    timebaseOverride: options.timebaseOverride,
    widthOverride: options.widthOverride,
    heightOverride: options.heightOverride,
    mediaRelativePath: `file://localhost/Media/${sourceFileName}`,
  });

  const lutText = generateCubeLut(project.colorGrade, project.name);
  const reportMd = generateReconstructionReportMarkdown(project);
  const relinkGuide = generateRelinkingGuide(project);

  zip.file(`Project/${safeBase}_Premiere.xml`, xmlText);
  if (options.includeCubeLut) {
    zip.file(`LUTs/Reconstructed_Look.cube`, lutText);
  }

  // 1. Separated Clips folder: CMX 3600 EDL, CSV cut sheet, individual standalone subclip XMLs & keyframe stills
  zip.file(`Clips/${safeBase}_Separated_Clips.edl`, generateSeparatedClipsEdl(project));
  zip.file(`Clips/Separated_Clips_CutList.csv`, generateSeparatedClipsCsv(project));
  project.shots.forEach((shot, idx) => {
    const clipPrefix = `Clip_${String(idx + 1).padStart(2, '0')}_${sanitizeFileName(shot.name).slice(0, 24)}`;
    zip.file(
      `Clips/${clipPrefix}.xml`,
      generateStandaloneSubclipXml(project, shot, idx, {
        timebaseOverride: options.timebaseOverride,
        widthOverride: options.widthOverride,
        heightOverride: options.heightOverride,
      })
    );
    if (shot.thumbnailDataUrl && shot.thumbnailDataUrl.includes('base64,')) {
      const b64 = shot.thumbnailDataUrl.split('base64,')[1];
      if (b64 && b64.length > 50) {
        zip.file(`Clips/${clipPrefix}_Frame.jpg`, b64, { base64: true });
      }
    }
  });

  // 2. Separate Caption & Title Layers: styled transparent vector SVG plates + Premiere .srt
  project.motionGraphics.forEach((gfx, idx) => {
    const prefix = gfx.isCaption || gfx.type === 'Caption' || gfx.type === 'Subtitle' ? 'Caption' : 'Title';
    const gfxName = `${prefix}_${String(idx + 1).padStart(2, '0')}_${sanitizeFileName(gfx.text).slice(0, 24)}.svg`;
    const svg = generateGraphicSvgPlate(
      gfx,
      options.widthOverride || project.metadata.width,
      options.heightOverride || project.metadata.height
    );
    zip.file(`Graphics/${gfxName}`, svg);
  });

  const srtText = generateSrtSubtitles(project.motionGraphics);
  if (srtText.trim().length > 0) {
    zip.file(`Captions/${safeBase}_Captions.srt`, srtText);
  }

  // 3. Separate Sound Design Layers: real 48kHz 16-bit stereo WAV stems for Music (A2), SFX (A3/A4), and Voiceover (A5)
  (project.audio.sections ?? []).forEach((sec, idx) => {
    const musicName = `Music_${String(idx + 1).padStart(2, '0')}_${sanitizeFileName(sec.name).slice(0, 24)}.wav`;
    const wavBytes = generateMusicSectionWav(sec, project.audio.estimatedBpm || 120);
    zip.file(`Audio/Music/${musicName}`, wavBytes);
  });

  (project.audio.sfxEvents ?? []).forEach((sfx, idx) => {
    const sfxName = `SFX_${String(idx + 1).padStart(2, '0')}_${sanitizeFileName(sfx.category)}_${sanitizeFileName(sfx.label).slice(0, 20)}.wav`;
    const wavBytes = generateSfxWav(sfx);
    zip.file(`Audio/SFX/${sfxName}`, wavBytes);
  });

  if (project.audio.voiceoverDetected) {
    if (project.motionGraphics.length > 0) {
      project.motionGraphics.forEach((g, idx) => {
        const clean = sanitizeFileName(g.text).slice(0, 20);
        const voName = `VO_${String(idx + 1).padStart(2, '0')}_${clean}.wav`;
        const wavBytes = generateVoiceoverCueWav(Math.max(0.3, g.endTimeSec - g.startTimeSec));
        zip.file(`Audio/Voiceover/${voName}`, wavBytes);
      });
    } else {
      const wavBytes = generateVoiceoverCueWav(project.metadata.durationSec);
      zip.file(`Audio/Voiceover/VO_01_Full_Dialogue_Guide.wav`, wavBytes);
    }
  }

  zip.file(
    `Manifests/Effects_And_Color_Manifest.json`,
    JSON.stringify(
      {
        project: project.name,
        colorGrade: project.colorGrade,
        includedFreeVideoEffects: project.effects.filter(
          (e) => e.includedInTimeline && e.licenseTier === 'Free / Built-in'
        ),
        skippedPaidVideoEffects: project.effects.filter(
          (e) => e.licenseTier === 'Paid / Third-Party'
        ),
        includedFreeAudioEffects: (project.audio.audioEffects ?? []).filter(
          (e) => e.includedInTimeline && e.licenseTier === 'Free / Built-in'
        ),
        skippedPaidAudioEffects: (project.audio.audioEffects ?? []).filter(
          (e) => e.licenseTier === 'Paid / Third-Party'
        ),
        audioSpectralProfile: project.audio.spectralProfile ?? null,
        captionsAndMotionGraphics: project.motionGraphics,
        srtCaptionsFile: srtText.trim().length > 0 ? `Captions/${safeBase}_Captions.srt` : null,
        sfxEvents: project.audio.sfxEvents,
      },
      null,
      2
    )
  );

  zip.file(
    `Manifests/Project_Settings.json`,
    JSON.stringify(
      {
        sequence: {
          width: options.widthOverride || project.metadata.width,
          height: options.heightOverride || project.metadata.height,
          fps: options.timebaseOverride || project.metadata.fps,
          aspectRatio: project.metadata.aspectRatio,
          durationSec: project.metadata.durationSec,
          audioSampleRate: project.audio.sampleRate,
          audioChannels: project.audio.channels,
        },
        summary: project.summary,
        comparison: project.comparison,
      },
      null,
      2
    )
  );

  zip.file(`Reports/Reconstruction_Report.md`, reportMd);
  zip.file(`Reports/Compatibility_Report.json`, JSON.stringify(project.compatibility, null, 2));
  zip.file(`README_RELINKING_GUIDE.txt`, relinkGuide);

  if (options.includeSourceMedia && options.sourceFile) {
    const buffer = await options.sourceFile.arrayBuffer();
    zip.file(`Media/${sourceFileName}`, buffer);
  } else {
    zip.file(
      `Media/PLACE_SOURCE_MEDIA_HERE.txt`,
      `Place your authorized original media file "${sourceFileName}" in this folder before importing Project/${safeBase}_Premiere.xml into Adobe Premiere Pro.`
    );
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    blob,
    fileName: `${safeBase}_Premiere_Package.zip`,
    xmlText,
    lutText,
  };
}

export function triggerFileDownload(blobOrText: Blob | string, fileName: string, mimeType = 'text/plain') {
  const blob =
    typeof blobOrText === 'string' ? new Blob([blobOrText], { type: mimeType }) : blobOrText;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
