import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  CaptionStylePreset,
  ColorGradeSettings,
  EffectItem,
  MotionGraphicItem,
  ReelProject,
} from '../types/project';
import {
  CAPTION_ANIMATION_OPTIONS,
  CAPTION_PRESET_NAMES,
  CAPTION_STYLE_PRESETS,
  generateSrtSubtitles,
} from '../engine/captionPresets';
import { buildColorFilterCss, formatTimecodeMs } from '../engine/formatters';
import { generateCubeLut, triggerFileDownload } from '../engine/premiereXmlGenerator';

/* ===================== 1. COLOR GRADING REVERSE ENGINEERING VIEW ===================== */

interface ColorAnalysisViewProps {
  project: ReelProject;
  videoUrl: string | null;
  onUpdateColorGrade: (next: ColorGradeSettings) => void;
}

const SLIDER_GROUPS: Array<{
  title: string;
  fields: Array<{ key: keyof ColorGradeSettings; label: string; min: number; max: number; step: number; unit: string }>;
}> = [
  {
    title: 'Tone & Exposure (Lumetri Basic)',
    fields: [
      { key: 'exposure', label: 'Exposure', min: -2, max: 2, step: 0.05, unit: 'EV' },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, unit: '' },
      { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, unit: '' },
      { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, unit: '' },
      { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1, unit: '' },
      { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1, unit: '' },
    ],
  },
  {
    title: 'White Balance & Color',
    fields: [
      { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1, unit: '' },
      { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, unit: '' },
      { key: 'saturation', label: 'Saturation', min: 0, max: 200, step: 1, unit: '%' },
      { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, unit: '' },
      { key: 'hueShift', label: 'Hue Shift', min: -30, max: 30, step: 1, unit: '°' },
    ],
  },
  {
    title: 'Creative Look & Finishing',
    fields: [
      { key: 'vignette', label: 'Vignette', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'sharpening', label: 'Sharpening', min: 0, max: 100, step: 1, unit: '' },
      { key: 'fade', label: 'Faded Film', min: 0, max: 100, step: 1, unit: '' },
      { key: 'filmGrain', label: 'Film Grain', min: 0, max: 100, step: 1, unit: '' },
    ],
  },
];

export const ColorAnalysisView: React.FC<ColorAnalysisViewProps> = ({
  project,
  onUpdateColorGrade,
}) => {
  const grade = project.colorGrade;
  const cssFilter = buildColorFilterCss(grade);
  const sampleThumb = project.shots[0]?.thumbnailDataUrl;

  const handleResetNeutral = () => {
    onUpdateColorGrade({
      ...grade,
      profileName: 'Neutral Reset (Rec. 709)',
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
    });
  };

  const renderHistogramPolyline = (bins: number[] | undefined, stroke: string) => {
    if (!bins || bins.length === 0) return null;
    const maxV = Math.max(...bins, 0.01);
    const pts = bins
      .map((v, i) => {
        const x = (i / (bins.length - 1)) * 300;
        const y = 96 - (v / maxV) * 86;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return <polyline fill="none" stroke={stroke} strokeWidth="2" points={pts} />;
  };

  return (
    <div className="max-w-[1160px] mx-auto px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-[26px] font-semibold text-white">
            Color Grading Reverse Engineering
          </h1>
          <p className="text-[14px] text-[#A5ACBF]">
            Estimated Lumetri-compatible look derived from rendered frame RGB histograms — editable
            with live preview and 17×17×17 .cube 3D LUT export.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleResetNeutral}
            className="px-3.5 py-2 rounded-lg bg-[#1A1D26] hover:bg-[#232736] border border-white/[0.1] text-[13px] font-medium text-[#D4D8E3] inline-flex items-center gap-2 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Neutral</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const cube = generateCubeLut(grade, project.name);
              triggerFileDownload(cube, `${project.name}_Look.cube`, 'text/plain');
            }}
            className="px-4 py-2 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4BF0] text-[13px] font-medium text-white inline-flex items-center gap-2 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Export .cube LUT</span>
          </button>
        </div>
      </div>

      {/* Transparency Note */}
      <div className="rounded-lg bg-[#101218] border border-white/[0.08] px-4 py-3 text-[12px] text-[#A5ACBF] flex flex-wrap items-center justify-between gap-3">
        <span>
          <strong className="text-white">Approximation Notice:</strong> Original project color nodes
          cannot be inverted losslessly from compressed pixels. These settings represent the closest
          visually matched Lumetri estimate.
        </span>
        <span className="font-mono tabular-nums text-[#9B82FF]">
          Profile: {grade.profileName} · Confidence: {grade.confidence} ({grade.confidenceScore}%)
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Live Reference Frames + RGB Histogram Scope */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-4 space-y-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium text-white">Reference Preview (Original vs Graded)</span>
              <span className="text-[#8E96AC]">{project.metadata.colorSpace}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="text-[11px] text-[#7F869B]">Original Frame</div>
                <div className="h-52 rounded-lg bg-black border border-white/[0.08] overflow-hidden flex items-center justify-center">
                  {sampleThumb ? (
                    <img
                      src={sampleThumb}
                      alt="Original reference"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <span className="text-[12px] text-[#555C70]">No frame</span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="text-[11px] text-[#9B82FF]">Reconstructed Look</div>
                <div className="relative h-52 rounded-lg bg-black border border-[#7C5CFF]/40 overflow-hidden flex items-center justify-center">
                  {sampleThumb ? (
                    <img
                      src={sampleThumb}
                      alt="Graded reference"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                      style={{ filter: cssFilter }}
                    />
                  ) : (
                    <span className="text-[12px] text-[#555C70]">No frame</span>
                  )}
                  {grade.vignette > 5 && (
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        background: `radial-gradient(circle, transparent 40%, rgba(0,0,0,${(
                          grade.vignette / 135
                        ).toFixed(2)}) 100%)`,
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Measured RGB Histogram Scope */}
          <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-4 space-y-3">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium text-white">Measured RGB Parade & Luma Scope</span>
              <span className="font-mono text-[11px] text-[#7F869B]">16-bin distribution</span>
            </div>
            <div className="rounded-lg bg-[#08090C] border border-white/[0.08] p-2">
              <svg viewBox="0 0 300 100" className="w-full h-28">
                <line x1="0" y1="50" x2="300" y2="50" stroke="rgba(255,255,255,0.06)" />
                <line x1="150" y1="0" x2="150" y2="100" stroke="rgba(255,255,255,0.06)" />
                {renderHistogramPolyline(grade.measuredHistogram?.r, 'rgba(239,68,68,0.85)')}
                {renderHistogramPolyline(grade.measuredHistogram?.g, 'rgba(34,197,94,0.85)')}
                {renderHistogramPolyline(grade.measuredHistogram?.b, 'rgba(59,130,246,0.9)')}
                {renderHistogramPolyline(grade.measuredHistogram?.luma, 'rgba(255,255,255,0.45)')}
              </svg>
            </div>
            <div className="text-[12px] text-[#A5ACBF] leading-relaxed">
              <span className="text-white font-medium">Skin Tone & Balance:</span>{' '}
              {grade.skinToneNote}
            </div>
          </div>
        </div>

        {/* Right: Lumetri Sliders */}
        <div className="lg:col-span-7 rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-6">
          {SLIDER_GROUPS.map((group) => (
            <div key={group.title} className="space-y-3">
              <h2 className="text-[14px] font-semibold text-white">{group.title}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {group.fields.map((f) => {
                  const val = Number(grade[f.key] ?? 0);
                  return (
                    <div key={f.key} className="space-y-1">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-[#A5ACBF]">{f.label}</span>
                        <span className="font-mono tabular-nums text-white">
                          {val > 0 && f.min < 0 ? `+${val}` : val}
                          {f.unit}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={val}
                        onChange={(e) =>
                          onUpdateColorGrade({
                            ...grade,
                            [f.key]: Number(e.target.value),
                          })
                        }
                        className="w-full"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ===================== 2. EFFECTS, TRANSITIONS & MOTION GRAPHICS VIEW ===================== */

interface EffectsAnalysisViewProps {
  project: ReelProject;
  onUpdateEffect: (effectId: string, patch: Partial<EffectItem>) => void;
  onUpdateGraphic: (gfxId: string, patch: Partial<MotionGraphicItem>) => void;
  onAddGraphic: () => void;
  onDeleteGraphic: (gfxId: string) => void;
}

export const EffectsAnalysisView: React.FC<EffectsAnalysisViewProps> = ({
  project,
  onUpdateEffect,
  onUpdateGraphic,
  onAddGraphic,
  onDeleteGraphic,
}) => {
  const [proofreading, setProofreading] = useState(false);
  const [proofreadNotice, setProofreadNotice] = useState<string | null>(null);

  const handleProofreadAllCaptions = async () => {
    if (project.motionGraphics.length === 0 || proofreading) return;
    setProofreading(true);
    setProofreadNotice(null);
    try {
      const res = await fetch('/api/captions/proofread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captions: project.motionGraphics.map((g) => ({
            id: g.id,
            text: g.text,
            highlightWord: g.highlightWord || '',
            startTimeSec: g.startTimeSec,
            endTimeSec: g.endTimeSec,
          })),
          contextNote: project.name,
        }),
      });
      if (!res.ok) {
        throw new Error('Spellcheck service returned an error');
      }
      const data = await res.json();
      const correctedList = Array.isArray(data?.corrected) ? data.corrected : [];
      let fixedCount = 0;

      correctedList.forEach(
        (item: { id?: string; text?: string; highlightWord?: string; fixedSpelling?: boolean }) => {
          if (!item?.id || typeof item.text !== 'string') return;
          const clean = item.text.replace(/\s+/g, ' ').trim();
          if (!clean) return;
          if (item.fixedSpelling) fixedCount++;
          onUpdateGraphic(item.id, {
            text: clean,
            highlightWord:
              typeof item.highlightWord === 'string' && item.highlightWord.trim().length > 0
                ? item.highlightWord.trim()
                : undefined,
            spellChecked: true,
          });
        }
      );

      setProofreadNotice(
        fixedCount > 0
          ? `Verified ${project.motionGraphics.length} captions — corrected ${fixedCount} spelling/OCR issue${fixedCount === 1 ? '' : 's'}.`
          : `All ${project.motionGraphics.length} captions verified with zero spelling mistakes.`
      );
    } catch (err) {
      setProofreadNotice(
        err instanceof Error ? err.message : 'Unable to complete spellcheck right now.'
      );
    } finally {
      setProofreading(false);
    }
  };

  return (
    <div className="max-w-[1160px] mx-auto px-8 py-8 space-y-8">
      <div className="space-y-1">
        <h1 className="font-display text-[26px] font-semibold text-white">
          Effects, Transitions & Motion Graphics
        </h1>
        <p className="text-[14px] text-[#A5ACBF]">
          Detected visual effects, transition mappings, and OCR-extracted text layers with Premiere
          Pro compatibility transparency.
        </p>
      </div>

      {/* Transitions Table */}
      <section className="rounded-xl bg-[#13151B] border border-white/[0.08] overflow-hidden">
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-white">Detected Shot Transitions</h2>
          <span className="text-[12px] font-mono tabular-nums text-[#8E96AC]">
            {project.shots.length} boundaries
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-[12px] text-[#7F869B]">
                <th className="py-2.5 px-5 font-medium">Shot Out</th>
                <th className="py-2.5 px-4 font-medium">Transition</th>
                <th className="py-2.5 px-4 font-medium text-right">Duration</th>
                <th className="py-2.5 px-4 font-medium text-right">Intensity</th>
                <th className="py-2.5 px-4 font-medium">Premiere Mapping</th>
                <th className="py-2.5 px-5 font-medium text-right">Support</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {project.shots.map((s) => (
                <tr key={s.id} className="hover:bg-white/[0.02]">
                  <td className="py-3 px-5">
                    <div className="font-medium text-white">{s.name}</div>
                    <div className="text-[11px] font-mono tabular-nums text-[#7F869B]">
                      {formatTimecodeMs(s.endTimeSec)}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-[#D4D8E3]">
                    {s.transitionOut.type}
                    {s.transitionOut.direction !== 'None' && (
                      <span className="text-[#7F869B]"> · {s.transitionOut.direction}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-right text-[#D4D8E3]">
                    {s.transitionOut.durationSec.toFixed(2)}s
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-right text-[#D4D8E3]">
                    {s.transitionOut.intensity}%
                  </td>
                  <td className="py-3 px-4 text-[#A5ACBF]">{s.transitionOut.premiereMapping}</td>
                  <td className="py-3 px-5 text-right font-medium">
                    <span
                      className={
                        s.transitionOut.premiereSupport === 'Native'
                          ? 'text-[#4ADE80]'
                          : s.transitionOut.premiereSupport === 'Approximate'
                          ? 'text-[#FBBF24]'
                          : 'text-[#F87171]'
                      }
                    >
                      {s.transitionOut.premiereSupport}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Visual Effects Section: Free / Built-in Included vs Paid Plugins Skipped */}
      {(() => {
        const freeVideoFx = project.effects.filter((ef) => ef.licenseTier !== 'Paid / Third-Party');
        const paidVideoFx = project.effects.filter((ef) => ef.licenseTier === 'Paid / Third-Party');

        return (
          <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-white">
                  Detected Visual Effects (Free Built-in Added · Paid Plugins Skipped)
                </h2>
                <p className="text-[12px] text-[#8E96AC]">
                  Every Free / Built-in Adobe Premiere Pro effect is bound to the reconstructed
                  timeline & XMEML. Paid third-party plugins are bypassed automatically without
                  halting processing.
                </p>
              </div>
              <span className="text-[12px] font-mono tabular-nums text-[#4ADE80]">
                {freeVideoFx.filter((e) => e.includedInTimeline !== false).length} Free FX Added
                {paidVideoFx.length > 0 ? ` · ${paidVideoFx.length} Paid Skipped` : ''}
              </span>
            </div>

            {freeVideoFx.length === 0 ? (
              <p className="text-[13px] text-[#7F869B]">
                No standalone built-in stylize, blur, glitch, or light effects were detected beyond
                standard motion and color grading.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {freeVideoFx.map((ef) => (
                  <div
                    key={ef.id}
                    className={`p-4 rounded-lg border space-y-3 transition-colors ${
                      ef.includedInTimeline !== false
                        ? 'bg-[#0C0D11] border-white/[0.08]'
                        : 'bg-[#0C0D11]/50 border-white/[0.04] opacity-60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[14px] font-semibold text-white truncate">
                          {ef.name}
                        </div>
                        <div className="text-[12px] text-[#8E96AC] font-mono tabular-nums">
                          {formatTimecodeMs(ef.startTimeSec)} – {formatTimecodeMs(ef.endTimeSec)} ·{' '}
                          {ef.category} · Free / Built-in · {ef.confidence}
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#4ADE80] shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={ef.includedInTimeline !== false}
                          onChange={(e) =>
                            onUpdateEffect(ef.id, { includedInTimeline: e.target.checked })
                          }
                          className="w-3.5 h-3.5 accent-[#7C5CFF]"
                        />
                        <span>{ef.includedInTimeline !== false ? 'In XMEML' : 'Off'}</span>
                      </label>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-[#8E96AC]">Reconstructed Intensity</span>
                        <span className="font-mono tabular-nums text-white">{ef.intensity}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={ef.intensity}
                        onChange={(e) => onUpdateEffect(ef.id, { intensity: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>

                    <div className="text-[12px] text-[#A5ACBF] leading-relaxed">
                      <span className="text-white font-medium">{ef.premiereEffectName}:</span>{' '}
                      {ef.approximationNote}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {paidVideoFx.length > 0 && (
              <div className="pt-4 border-t border-white/[0.08] space-y-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-[#FBBF24]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Skipped Paid / Third-Party Video Effects ({paidVideoFx.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {paidVideoFx.map((ef) => (
                    <div
                      key={ef.id}
                      className="p-3.5 rounded-lg bg-[#19150E] border border-[#D97706]/35 space-y-1.5 text-[12px]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white">{ef.name}</span>
                        <span className="font-mono text-[#FBBF24] shrink-0">Paid · Skipped</span>
                      </div>
                      <div className="text-[#8E96AC] font-mono tabular-nums">
                        {formatTimecodeMs(ef.startTimeSec)} – {formatTimecodeMs(ef.endTimeSec)} ·{' '}
                        Vendor: {ef.pluginVendor || 'Third-Party'}
                      </div>
                      <p className="text-[#D4D8E3] leading-relaxed">
                        {ef.skippedReason || ef.approximationNote}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        );
      })()}

      {/* Captions, Styling, Animations & OCR Motion Graphics */}
      <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-[15px] font-semibold text-white">
              Captions, Styles &amp; Animated Text Layers (Track V3 + Premiere .srt)
            </h2>
            <p className="text-[12px] text-[#8E96AC]">
              Captions detected in video frames are automatically spell-checked and reconstructed
              with matching styles, keyword highlights, and animations—exported as animated Track V3
              SVG plates plus a Premiere-ready .srt caption file.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={project.motionGraphics.length === 0 || proofreading}
              onClick={handleProofreadAllCaptions}
              className="px-3 py-2 rounded-lg bg-[#1A1D26] hover:bg-[#232736] disabled:opacity-45 disabled:pointer-events-none border border-[#7C5CFF]/40 text-[12px] font-medium text-white inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {proofreading ? (
                <Loader2 className="w-3.5 h-3.5 text-[#9B82FF] animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 text-[#9B82FF]" />
              )}
              <span>{proofreading ? 'Verifying Spelling...' : 'AI Spellcheck All'}</span>
            </button>
            <button
              type="button"
              disabled={project.motionGraphics.length === 0}
              onClick={() =>
                triggerFileDownload(
                  generateSrtSubtitles(project.motionGraphics),
                  `${project.name}_Captions.srt`,
                  'application/x-subrip'
                )
              }
              className="px-3 py-2 rounded-lg bg-[#1A1D26] hover:bg-[#232736] disabled:opacity-45 disabled:pointer-events-none border border-white/[0.1] text-[12px] font-medium text-white inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-[#FACC15]" />
              <span>Download .srt</span>
            </button>
            <button
              type="button"
              onClick={onAddGraphic}
              className="px-3.5 py-2 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4DF2] text-[12px] font-medium text-white inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Caption / Title</span>
            </button>
          </div>
        </div>

        {proofreadNotice && (
          <div className="px-3.5 py-2.5 rounded-lg bg-[#0C0D11] border border-[#4ADE80]/30 text-[12px] text-[#D4D8E3] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#4ADE80] shrink-0" />
            <span>{proofreadNotice}</span>
          </div>
        )}

        {project.motionGraphics.length === 0 ? (
          <div className="p-6 rounded-lg bg-[#0C0D11] border border-white/[0.06] text-[13px] text-[#7F869B]">
            No visible on-screen captions or titles were detected in this video. Click &quot;Add
            Caption / Title&quot; to place a styled, animated caption layer on Track V3 and export
            it to Premiere Pro.
          </div>
        ) : (
          <div className="space-y-3">
            {project.motionGraphics.map((g, idx) => (
              <div
                key={g.id}
                className="p-4 rounded-lg bg-[#0C0D11] border border-white/[0.08] space-y-3"
              >
                {/* Row 1: Caption copy, Preset, Animation, Timing & Delete */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-5 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#7F869B]">
                        #{idx + 1} · {g.isCaption ? 'Caption' : g.type}
                      </span>
                      {g.spellChecked && (
                        <span className="text-[#4ADE80] inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Spellcheck Verified</span>
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={g.text}
                      onChange={(e) => onUpdateGraphic(g.id, { text: e.target.value })}
                      className="w-full h-9 px-3 rounded-md bg-[#13151B] border border-white/[0.12] text-[13px] text-white"
                    />
                  </div>

                  <div className="md:col-span-3 space-y-1">
                    <label className="text-[11px] text-[#7F869B]">Caption Style Preset</label>
                    <select
                      value={g.captionStylePreset || 'Bold Hormozi'}
                      onChange={(e) => {
                        const preset = e.target.value as CaptionStylePreset;
                        onUpdateGraphic(g.id, CAPTION_STYLE_PRESETS[preset].patch);
                      }}
                      className="w-full h-9 px-2.5 rounded-md bg-[#13151B] border border-white/[0.12] text-[12px] text-white"
                    >
                      {CAPTION_PRESET_NAMES.map((presetName) => (
                        <option key={presetName} value={presetName}>
                          {presetName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2 space-y-1">
                    <label className="text-[11px] text-[#7F869B]">Animation</label>
                    <select
                      value={g.animationType}
                      onChange={(e) =>
                        onUpdateGraphic(g.id, {
                          animationType: e.target.value as MotionGraphicItem['animationType'],
                        })
                      }
                      className="w-full h-9 px-2.5 rounded-md bg-[#13151B] border border-white/[0.12] text-[12px] text-white"
                    >
                      {CAPTION_ANIMATION_OPTIONS.map((anim) => (
                        <option key={anim} value={anim}>
                          {anim === 'None' ? 'Static' : anim}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-2 flex items-center justify-between gap-2 h-9">
                    <span className="text-[12px] font-mono tabular-nums text-[#D4D8E3]">
                      {g.startTimeSec.toFixed(1)}s – {g.endTimeSec.toFixed(1)}s
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteGraphic(g.id)}
                      title="Delete caption layer"
                      className="p-2 rounded-md text-[#8E96AC] hover:text-[#F87171] hover:bg-white/[0.06]"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Row 2: Fine caption styling controls */}
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 pt-2 border-t border-white/[0.06] items-end text-[11px]">
                  <div className="space-y-1">
                    <label className="text-[#7F869B]">Highlight Word</label>
                    <input
                      type="text"
                      placeholder="e.g. WATCH"
                      value={g.highlightWord || ''}
                      onChange={(e) =>
                        onUpdateGraphic(g.id, { highlightWord: e.target.value || undefined })
                      }
                      className="w-full h-8 px-2 rounded bg-[#13151B] border border-white/[0.1] text-[12px] text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[#7F869B]">Text Case</label>
                    <select
                      value={g.textTransform || 'none'}
                      onChange={(e) =>
                        onUpdateGraphic(g.id, {
                          textTransform: e.target.value as MotionGraphicItem['textTransform'],
                        })
                      }
                      className="w-full h-8 px-2 rounded bg-[#13151B] border border-white/[0.1] text-[12px] text-white"
                    >
                      <option value="uppercase">UPPERCASE</option>
                      <option value="capitalize">Capitalize</option>
                      <option value="none">Normal</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[#7F869B]">Size (px)</label>
                    <input
                      type="number"
                      min={16}
                      max={120}
                      value={g.fontSize}
                      onChange={(e) => onUpdateGraphic(g.id, { fontSize: Number(e.target.value) })}
                      className="w-full h-8 px-2 rounded bg-[#13151B] border border-white/[0.1] text-[12px] font-mono text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[#7F869B]">
                      <span>Outline</span>
                      <span className="font-mono text-[#D4D8E3]">{g.outlineWidthPx ?? 2}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      value={g.outlineWidthPx ?? 2}
                      onChange={(e) =>
                        onUpdateGraphic(g.id, { outlineWidthPx: Number(e.target.value) })
                      }
                      className="w-full h-8"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[#7F869B]">
                      <span>Box Opacity</span>
                      <span className="font-mono text-[#D4D8E3]">{g.backgroundOpacity ?? 0}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={g.backgroundOpacity ?? 0}
                      onChange={(e) =>
                        onUpdateGraphic(g.id, { backgroundOpacity: Number(e.target.value) })
                      }
                      className="w-full h-8"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 h-8">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] text-[#7F869B]">Text</span>
                      <input
                        type="color"
                        aria-label="Primary text color"
                        value={g.colorHex}
                        onChange={(e) => onUpdateGraphic(g.id, { colorHex: e.target.value })}
                        className="w-6 h-6 rounded bg-transparent border border-white/[0.15] cursor-pointer"
                      />
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] text-[#7F869B]">Pop</span>
                      <input
                        type="color"
                        aria-label="Highlight color"
                        value={g.highlightColorHex || '#FACC15'}
                        onChange={(e) =>
                          onUpdateGraphic(g.id, { highlightColorHex: e.target.value })
                        }
                        className="w-6 h-6 rounded bg-transparent border border-white/[0.15] cursor-pointer"
                      />
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] text-[#7F869B]">Box</span>
                      <input
                        type="color"
                        aria-label="Background box color"
                        value={g.backgroundColorHex || '#000000'}
                        onChange={(e) =>
                          onUpdateGraphic(g.id, { backgroundColorHex: e.target.value })
                        }
                        className="w-6 h-6 rounded bg-transparent border border-white/[0.15] cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
