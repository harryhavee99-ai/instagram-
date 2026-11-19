import JSZip from 'jszip';
import type { ColorGradeSettings, MotionGraphicItem, ReelProject } from '../types/project';
import { clamp, formatTimecodeMs } from './formatters';

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

    const shotBlurEffect = project.effects.find(
      (ef) => ef.shotId === shot.id && ef.category === 'Blur'
    );
    const blurFilterXml = shotBlurEffect
      ? `
              <filter>
                <effect>
                  <name>Gaussian Blur</name>
                  <effectid>Gaussian Blur</effectid>
                  <effectcategory>Blur</effectcategory>
                  <effecttype>filter</effecttype>
                  <mediatype>video</mediatype>
                  <parameter>
                    <parameterid>radius</parameterid>
                    <name>Blurriness</name>
                    <valuemin>0</valuemin>
                    <valuemax>200</valuemax>
                    <value>${Math.round(shotBlurEffect.intensity * 0.6)}</value>
                  </parameter>
                </effect>
              </filter>`
      : '';

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
            </filter>${speedFilterXml}${blurFilterXml}
            <comments>
              <mastercomment1>${escapeXml(`${shot.shotType} | ${shot.cameraMovement} | Confidence: ${shot.confidence}`)}</mastercomment1>
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

  // Build Video Track 3 (Editable SVG/Graphic title plates)
  const v3Items = project.motionGraphics.map((gfx, idx) => {
    const startF = toFrames(gfx.startTimeSec, timebase);
    const endF = Math.max(startF + 2, toFrames(gfx.endTimeSec, timebase));
    const durF = endF - startF;
    const gfxFileName = `Title_${String(idx + 1).padStart(2, '0')}_${sanitizeFileName(gfx.text).slice(0, 24)}.svg`;

    return `
          <clipitem id="v3-gfx-${idx + 1}">
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
            <file id="gfx-file-${idx + 1}">
              <name>${escapeXml(gfxFileName)}</name>
              <pathurl>${escapeXml(`file://localhost/Graphics/${gfxFileName}`)}</pathurl>
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
            </file>
            <comments>
              <mastercomment1>${escapeXml(`OCR ${gfx.type} | Font: ${gfx.fontFamily} ${gfx.fontSize}px | Anim: ${gfx.animationType}`)}</mastercomment1>
            </comments>
          </clipitem>`;
  });

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

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <project>
    <name>${safeProjectName}</name>
    <children>
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
              <!-- V1: Main Reconstructed Video Cuts -->${v1Items.join('')}
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- V2: Secondary / Overlay / Adjustment Layer Track -->
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- V3: Reconstructed OCR Titles & Motion Graphics -->${v3Items.join('')}
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
              <!-- A1: Original Authorized Source Audio -->
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
                </filter>
              </clipitem>
              <enabled>${a1Track?.muted ? 'FALSE' : 'TRUE'}</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- A2: Background Music Reference Track (Drop licensed music here; see Beat Markers) -->
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- A3: Sound Effects Track (Aligned to SFX Markers) -->
              <enabled>TRUE</enabled>
              <locked>FALSE</locked>
            </track>
            <track>
              <!-- A4: Voiceover / Dialogue Track -->
              <enabled>TRUE</enabled>
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
  const scaledSize = Math.round(gfx.fontSize * (width / 540));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.65"/>
    </filter>
  </defs>
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
    stroke-width="2"
    paint-order="stroke"
    ${gfx.hasShadow ? 'filter="url(#dropShadow)"' : ''}
  >${escapeXml(gfx.text)}</text>
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
    `### Unsupported / Third-Party Effects`,
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
   - Project/Reel2Premiere_Sequence.xml
   - Media/${sourceFileName}
   - LUTs/Reconstructed_Look.cube
   - Graphics/Title_*.svg
   - Manifests/
   - Reports/

2. IMPORT INTO ADOBE PREMIERE PRO
   - Open Adobe Premiere Pro and create or open a project.
   - Go to File > Import... (Ctrl+I / Cmd+I).
   - Select: Project/Reel2Premiere_Sequence.xml
   - Double-click the imported sequence "${project.name}_Reconstructed" in the Project Panel.

3. RELINK MEDIA (IF PROMPTED)
   - If Premiere Pro opens the "Link Media" dialog for ${sourceFileName}:
     Click "Locate...", navigate to the Media/ folder inside this extracted ZIP,
     select ${sourceFileName}, and click OK.
   - Repeat for any Graphics/Title_*.svg plates if Premiere requests their path.

4. APPLY THE RECONSTRUCTED COLOR GRADE (.cube LUT)
   - Add an Adjustment Layer on Track V2 spanning the sequence (or select clips on V1).
   - Open Window > Lumetri Color > Creative (or Basic Correction > Input LUT).
   - Browse and select: LUTs/Reconstructed_Look.cube
   - Adjust Intensity slider to taste. Note: Estimated color grades are approximations
     derived from rendered pixels; fine-tune skin tones using Lumetri Scopes.

5. AUDIO & BEAT MARKERS
   - Sequence markers on the timeline ruler mark every detected beat (${project.audio.estimatedBpm || 'N/A'} BPM)
     and transition SFX cue.
   - Track A1 contains your authorized source audio.
   - Track A2 is reserved for a licensed music replacement if redistributing the project.
   - Track A3 is reserved for sound effects (whooshes, impacts, risers).

6. REVIEW COMPATIBILITY REPORT
   - Open Reports/Reconstruction_Report.md for a full list of native vs. approximate effects.
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

  // Generate transparent SVG graphic plates for every OCR-detected motion graphic
  project.motionGraphics.forEach((gfx, idx) => {
    const gfxName = `Title_${String(idx + 1).padStart(2, '0')}_${sanitizeFileName(gfx.text).slice(0, 24)}.svg`;
    const svg = generateGraphicSvgPlate(
      gfx,
      options.widthOverride || project.metadata.width,
      options.heightOverride || project.metadata.height
    );
    zip.file(`Graphics/${gfxName}`, svg);
  });

  zip.file(
    `Manifests/Effects_And_Color_Manifest.json`,
    JSON.stringify(
      {
        project: project.name,
        colorGrade: project.colorGrade,
        effects: project.effects,
        motionGraphics: project.motionGraphics,
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
