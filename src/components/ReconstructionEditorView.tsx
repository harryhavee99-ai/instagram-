import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  ColorGradeSettings,
  EffectItem,
  MotionGraphicItem,
  ReelProject,
  ShotClip,
  ShotTransition,
} from '../types/project';
import { formatShortSec, formatSmpte } from '../engine/formatters';
import { MultitrackTimeline } from './MultitrackTimeline';
import { MonitorViewMode, VideoMonitor } from './VideoMonitor';

const COLOR_PRESETS: Array<{ name: string; patch: Partial<ColorGradeSettings> }> = [
  {
    name: 'Warm Cinematic',
    patch: { profileName: 'Warm Cinematic', temperature: 22, contrast: 18, saturation: 112, vignette: 24, fade: 8 },
  },
  {
    name: 'Cool Editorial',
    patch: { profileName: 'Cool Editorial', temperature: -20, contrast: 14, saturation: 94, shadows: -12, vignette: 18 },
  },
  {
    name: 'Lifted Matte Film',
    patch: { profileName: 'Lifted Matte Film', fade: 28, blacks: 16, contrast: -8, saturation: 90, filmGrain: 24 },
  },
  {
    name: 'Crisp Commercial',
    patch: { profileName: 'Crisp Commercial', contrast: 24, saturation: 122, sharpening: 38, vignette: 10, fade: 0 },
  },
];

interface ReconstructionEditorViewProps {
  project: ReelProject;
  videoUrl: string | null;
  currentTimeSec: number;
  isPlaying: boolean;
  selectedShotId: string | null;
  selectedGraphicId: string | null;
  selectedEffectId: string | null;
  onSelectShot: (id: string) => void;
  onSelectGraphic: (id: string) => void;
  onSelectEffect: (id: string) => void;
  onTimeUpdate: (t: number) => void;
  onTogglePlay: () => void;
  onStepFrame: (dt: number) => void;
  onUpdateShot: (shotId: string, patch: Partial<ShotClip>) => void;
  onUpdateColorGrade: (next: ColorGradeSettings) => void;
  onUpdateGraphic: (gfxId: string, patch: Partial<MotionGraphicItem>) => void;
  onUpdateEffect: (fxId: string, patch: Partial<EffectItem>) => void;
  onAddGraphic: () => void;
  onSplitAtPlayhead: () => void;
  onToggleTrackMute: (trackId: 'A1' | 'A2' | 'A3' | 'A4') => void;
  onTrimShotBoundary: (shotId: string, edge: 'start' | 'end', newTimeSec: number) => void;
}

export const ReconstructionEditorView: React.FC<ReconstructionEditorViewProps> = ({
  project,
  videoUrl,
  currentTimeSec,
  isPlaying,
  selectedShotId,
  selectedGraphicId,
  selectedEffectId,
  onSelectShot,
  onSelectGraphic,
  onSelectEffect,
  onTimeUpdate,
  onTogglePlay,
  onStepFrame,
  onUpdateShot,
  onUpdateColorGrade,
  onUpdateGraphic,
  onUpdateEffect,
  onAddGraphic,
  onSplitAtPlayhead,
  onToggleTrackMute,
  onTrimShotBoundary,
}) => {
  const [leftTab, setLeftTab] = useState<'shots' | 'media' | 'effects' | 'audio' | 'color' | 'graphics'>('shots');
  const [rightTab, setRightTab] = useState<'clip' | 'color' | 'keyframes' | 'text'>('clip');
  const [monitorMode, setMonitorMode] = useState<MonitorViewMode>('reconstructed');

  const activeShot =
    project.shots.find((s) => s.id === selectedShotId) ||
    project.shots.find((s) => currentTimeSec >= s.startTimeSec && currentTimeSec <= s.endTimeSec) ||
    project.shots[0];

  const activeGraphic =
    project.motionGraphics.find((g) => g.id === selectedGraphicId) || project.motionGraphics[0];

  const activeEffect = project.effects.find((e) => e.id === selectedEffectId);

  const handleAddScaleKeyframe = () => {
    if (!activeShot) return;
    const relTime = Math.max(
      0,
      Math.min(activeShot.durationSec, Number((currentTimeSec - activeShot.startTimeSec).toFixed(2)))
    );
    const nextKf = {
      id: `kf-${Date.now()}`,
      timeSec: relTime,
      property: 'scale' as const,
      value: activeShot.scale,
      easing: 'Ease Out' as const,
    };
    onUpdateShot(activeShot.id, {
      keyframes: [...activeShot.keyframes, nextKf].sort((a, b) => a.timeSec - b.timeSec),
    });
  };

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col p-3 gap-3 bg-[#0C0D11] overflow-hidden">
      {/* Top 3-Panel NLE Workspace */}
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-3">
        {/* LEFT PANEL: Media / Shots / Effects / Audio / Color Presets / Graphics */}
        <div className="col-span-3 bg-[#101218] rounded-xl border border-white/[0.08] flex flex-col overflow-hidden min-h-0">
          <div className="p-2 border-b border-white/[0.08] flex flex-wrap gap-1">
            {(
              [
                ['shots', 'Shots'],
                ['media', 'Media'],
                ['effects', 'FX'],
                ['audio', 'Audio'],
                ['color', 'Color'],
                ['graphics', 'GFX'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLeftTab(id)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  leftTab === id
                    ? 'bg-[#7C5CFF] text-white'
                    : 'text-[#8E96AC] hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 text-[12px]">
            {leftTab === 'shots' &&
              project.shots.map((shot) => (
                <button
                  key={shot.id}
                  type="button"
                  onClick={() => {
                    onSelectShot(shot.id);
                    onTimeUpdate(shot.startTimeSec);
                    setRightTab('clip');
                  }}
                  className={`w-full p-2 rounded-lg border text-left flex items-center gap-2.5 transition-colors ${
                    activeShot?.id === shot.id
                      ? 'bg-[#7C5CFF]/18 border-[#7C5CFF]/60 text-white'
                      : 'bg-[#0B0C10] border-white/[0.06] text-[#C6CBD9] hover:border-white/[0.15]'
                  }`}
                >
                  {shot.thumbnailDataUrl && (
                    <img
                      src={shot.thumbnailDataUrl}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-9 h-12 object-cover rounded shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{shot.name}</div>
                    <div className="text-[11px] font-mono tabular-nums text-[#8E96AC]">
                      {formatSmpte(shot.startTimeSec, project.metadata.fps)} · {shot.durationSec.toFixed(2)}s
                    </div>
                    <div className="text-[11px] text-[#6E768C] truncate">{shot.cameraMovement}</div>
                  </div>
                </button>
              ))}

            {leftTab === 'media' && (
              <div className="space-y-2.5">
                <div className="p-3 rounded-lg bg-[#0B0C10] border border-white/[0.08] space-y-1">
                  <div className="font-medium text-white truncate">{project.metadata.fileName}</div>
                  <div className="font-mono text-[11px] text-[#8E96AC]">
                    {project.metadata.width}×{project.metadata.height} · {project.metadata.fps} fps
                  </div>
                  <div className="text-[11px] text-[#6E768C]">
                    {project.metadata.container} · {project.metadata.codec}
                  </div>
                </div>
                <div className="text-[11px] text-[#7F869B] leading-relaxed">
                  Original source quality is preserved for Premiere Pro relinking. Proxy preview
                  scale: {project.metadata.proxyScale}px.
                </div>
              </div>
            )}

            {leftTab === 'effects' &&
              (project.effects.length === 0 ? (
                <div className="text-[#7F869B] p-2">No standalone VFX detected.</div>
              ) : (
                project.effects.map((ef) => (
                  <button
                    key={ef.id}
                    type="button"
                    onClick={() => {
                      onSelectEffect(ef.id);
                      onTimeUpdate(ef.startTimeSec);
                    }}
                    className={`w-full p-2.5 rounded-lg border text-left transition-colors ${
                      selectedEffectId === ef.id
                        ? 'bg-[#3B82F6]/20 border-[#3B82F6]/60 text-white'
                        : 'bg-[#0B0C10] border-white/[0.06] text-[#C6CBD9]'
                    }`}
                  >
                    <div className="font-medium">{ef.name}</div>
                    <div className="text-[11px] text-[#8E96AC] font-mono">
                      {ef.startTimeSec.toFixed(2)}s – {ef.endTimeSec.toFixed(2)}s · {ef.intensity}%
                    </div>
                  </button>
                ))
              ))}

            {leftTab === 'audio' && (
              <div className="space-y-2">
                <div className="p-2.5 rounded-lg bg-[#0B0C10] border border-white/[0.08]">
                  <div className="font-medium text-white">
                    {project.audio.hasAudio ? `${project.audio.estimatedBpm} BPM Grid` : 'No Audio'}
                  </div>
                  <div className="text-[11px] text-[#8E96AC] mt-0.5">
                    {project.audio.beats.length} beat markers · {project.audio.sfxEvents.length} SFX
                  </div>
                </div>
                {project.audio.sfxEvents.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onTimeUpdate(s.timeSec)}
                    className="w-full p-2 rounded-lg bg-[#0B0C10] border border-white/[0.06] hover:border-[#38BDF8]/40 text-left"
                  >
                    <div className="font-medium text-white">{s.label}</div>
                    <div className="text-[11px] font-mono text-[#7F869B]">
                      {formatShortSec(s.timeSec)} · {s.category}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {leftTab === 'color' && (
              <div className="space-y-2">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() =>
                      onUpdateColorGrade({
                        ...project.colorGrade,
                        ...preset.patch,
                      })
                    }
                    className="w-full p-2.5 rounded-lg bg-[#0B0C10] border border-white/[0.08] hover:border-[#7C5CFF]/60 text-left transition-colors"
                  >
                    <div className="font-medium text-white">{preset.name}</div>
                    <div className="text-[11px] text-[#7F869B]">Apply Lumetri preset look</div>
                  </button>
                ))}
              </div>
            )}

            {leftTab === 'graphics' && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    onAddGraphic();
                    setRightTab('text');
                  }}
                  className="w-full py-2 px-3 rounded-lg bg-[#1A1D26] hover:bg-[#232736] text-white font-medium inline-flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5 text-[#9B82FF]" />
                  <span>Add Editable Title</span>
                </button>
                {project.motionGraphics.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => {
                      onSelectGraphic(g.id);
                      onTimeUpdate(g.startTimeSec);
                      setRightTab('text');
                    }}
                    className={`w-full p-2.5 rounded-lg border text-left ${
                      selectedGraphicId === g.id
                        ? 'bg-[#A855F7]/20 border-[#C084FC]/60 text-white'
                        : 'bg-[#0B0C10] border-white/[0.06] text-[#C6CBD9]'
                    }`}
                  >
                    <div className="font-medium truncate">{g.text}</div>
                    <div className="text-[11px] font-mono text-[#8E96AC]">
                      {g.startTimeSec.toFixed(1)}s – {g.endTimeSec.toFixed(1)}s · {g.animationType}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* CENTER PANEL: Synchronized Program / Split Monitor */}
        <div className="col-span-6 min-h-0">
          <VideoMonitor
            project={project}
            videoUrl={videoUrl}
            currentTimeSec={currentTimeSec}
            isPlaying={isPlaying}
            viewMode={monitorMode}
            onViewModeChange={setMonitorMode}
            onTimeUpdate={onTimeUpdate}
            onTogglePlay={onTogglePlay}
            onStepFrame={onStepFrame}
          />
        </div>

        {/* RIGHT PANEL: Properties Inspector */}
        <div className="col-span-3 bg-[#101218] rounded-xl border border-white/[0.08] flex flex-col overflow-hidden min-h-0">
          <div className="p-2 border-b border-white/[0.08] flex gap-1">
            {(
              [
                ['clip', 'Clip & FX'],
                ['color', 'Color'],
                ['keyframes', 'Keyframes'],
                ['text', 'Titles'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRightTab(id)}
                className={`flex-1 py-1 rounded text-[11px] font-medium transition-colors ${
                  rightTab === id
                    ? 'bg-[#7C5CFF] text-white'
                    : 'text-[#8E96AC] hover:text-white hover:bg-white/[0.05]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-[12px]">
            {rightTab === 'clip' && activeShot && (
              <>
                <div className="space-y-1">
                  <div className="text-[11px] text-[#7F869B]">Selected Clip</div>
                  <input
                    type="text"
                    value={activeShot.name}
                    onChange={(e) => onUpdateShot(activeShot.id, { name: e.target.value })}
                    className="w-full h-8 px-2.5 rounded bg-[#0B0C10] border border-white/[0.1] text-white text-[12px]"
                  />
                </div>

                {/* Transform sliders */}
                {(
                  [
                    ['scale', 'Scale', 50, 200, 1, '%'],
                    ['positionX', 'Position X', -250, 250, 2, 'px'],
                    ['positionY', 'Position Y', -250, 250, 2, 'px'],
                    ['rotation', 'Rotation', -45, 45, 1, '°'],
                    ['opacity', 'Opacity', 0, 100, 1, '%'],
                    ['speedPercent', 'Playback Speed', 25, 300, 5, '%'],
                  ] as const
                ).map(([field, label, min, max, step, unit]) => (
                  <div key={field} className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-[#A5ACBF]">{label}</span>
                      <span className="font-mono tabular-nums text-white">
                        {activeShot[field]}
                        {unit}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={activeShot[field]}
                      onChange={(e) =>
                        onUpdateShot(activeShot.id, { [field]: Number(e.target.value) })
                      }
                      className="w-full"
                    />
                  </div>
                ))}

                {/* Outgoing Transition Controls */}
                <div className="pt-3 border-t border-white/[0.08] space-y-2.5">
                  <div className="font-medium text-white">Outgoing Transition</div>
                  <select
                    value={activeShot.transitionOut.type}
                    onChange={(e) =>
                      onUpdateShot(activeShot.id, {
                        transitionOut: {
                          ...activeShot.transitionOut,
                          type: e.target.value as ShotTransition['type'],
                          durationSec:
                            e.target.value === 'Cut'
                              ? 0
                              : Math.max(0.25, activeShot.transitionOut.durationSec),
                        },
                      })
                    }
                    className="w-full h-8 px-2 rounded bg-[#0B0C10] border border-white/[0.1] text-white text-[12px]"
                  >
                    {[
                      'Cut',
                      'Cross Dissolve',
                      'Fade Out',
                      'Zoom Transition',
                      'Whip Pan',
                      'Push',
                      'Slide',
                      'Blur Transition',
                      'Flash Transition',
                      'Glitch',
                      'Light Leak',
                    ].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>

                  {activeShot.transitionOut.type !== 'Cut' && (
                    <>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-[#A5ACBF]">Duration</span>
                          <span className="font-mono text-white">
                            {activeShot.transitionOut.durationSec.toFixed(2)}s
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.1}
                          max={1.5}
                          step={0.05}
                          value={activeShot.transitionOut.durationSec}
                          onChange={(e) =>
                            onUpdateShot(activeShot.id, {
                              transitionOut: {
                                ...activeShot.transitionOut,
                                durationSec: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-[#A5ACBF]">Intensity</span>
                          <span className="font-mono text-white">
                            {activeShot.transitionOut.intensity}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={100}
                          value={activeShot.transitionOut.intensity}
                          onChange={(e) =>
                            onUpdateShot(activeShot.id, {
                              transitionOut: {
                                ...activeShot.transitionOut,
                                intensity: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full"
                        />
                      </div>
                    </>
                  )}
                </div>

                {activeEffect && (
                  <div className="pt-3 border-t border-white/[0.08] space-y-2">
                    <div className="font-medium text-[#93C5FD]">Selected FX: {activeEffect.name}</div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={activeEffect.intensity}
                      onChange={(e) =>
                        onUpdateEffect(activeEffect.id, { intensity: Number(e.target.value) })
                      }
                      className="w-full"
                    />
                  </div>
                )}
              </>
            )}

            {rightTab === 'color' && (
              <div className="space-y-3">
                <div className="font-medium text-white">{project.colorGrade.profileName}</div>
                {(
                  [
                    ['exposure', 'Exposure', -2, 2, 0.05],
                    ['contrast', 'Contrast', -100, 100, 1],
                    ['temperature', 'Temperature', -100, 100, 1],
                    ['tint', 'Tint', -100, 100, 1],
                    ['saturation', 'Saturation', 0, 200, 1],
                    ['vignette', 'Vignette', 0, 100, 1],
                    ['fade', 'Fade', 0, 100, 1],
                  ] as const
                ).map(([key, label, min, max, step]) => (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-[#A5ACBF]">{label}</span>
                      <span className="font-mono tabular-nums text-white">
                        {project.colorGrade[key]}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={project.colorGrade[key]}
                      onChange={(e) =>
                        onUpdateColorGrade({
                          ...project.colorGrade,
                          [key]: Number(e.target.value),
                        })
                      }
                      className="w-full"
                    />
                  </div>
                ))}
              </div>
            )}

            {rightTab === 'keyframes' && activeShot && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">Scale Keyframes</span>
                  <button
                    type="button"
                    onClick={handleAddScaleKeyframe}
                    className="px-2 py-1 rounded bg-[#7C5CFF] text-white text-[11px] font-medium"
                  >
                    + Add at Playhead
                  </button>
                </div>

                {activeShot.keyframes.length === 0 ? (
                  <p className="text-[#7F869B]">
                    No keyframes on this clip yet. Click "+ Add at Playhead" to animate Scale in
                    Premiere XMEML.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {activeShot.keyframes.map((kf) => (
                      <div
                        key={kf.id}
                        className="p-2.5 rounded-lg bg-[#0B0C10] border border-white/[0.08] space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[#FBBF24]">
                            t={kf.timeSec.toFixed(2)}s · {kf.property}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateShot(activeShot.id, {
                                keyframes: activeShot.keyframes.filter((x) => x.id !== kf.id),
                              })
                            }
                            className="text-[#7F869B] hover:text-[#F87171]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={60}
                            max={200}
                            value={kf.value}
                            onChange={(e) =>
                              onUpdateShot(activeShot.id, {
                                keyframes: activeShot.keyframes.map((x) =>
                                  x.id === kf.id ? { ...x, value: Number(e.target.value) } : x
                                ),
                              })
                            }
                            className="flex-1"
                          />
                          <span className="font-mono text-white w-10 text-right">{kf.value}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rightTab === 'text' && (
              <div className="space-y-3">
                {activeGraphic ? (
                  <>
                    <div className="space-y-1">
                      <label className="text-[11px] text-[#7F869B]">Title Text</label>
                      <input
                        type="text"
                        value={activeGraphic.text}
                        onChange={(e) =>
                          onUpdateGraphic(activeGraphic.id, { text: e.target.value })
                        }
                        className="w-full h-8 px-2.5 rounded bg-[#0B0C10] border border-white/[0.1] text-white"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[#A5ACBF]">Vertical Position</span>
                        <span className="font-mono text-white">
                          {activeGraphic.positionYPercent}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={90}
                        value={activeGraphic.positionYPercent}
                        onChange={(e) =>
                          onUpdateGraphic(activeGraphic.id, {
                            positionYPercent: Number(e.target.value),
                          })
                        }
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[#A5ACBF]">Font Size</span>
                        <span className="font-mono text-white">{activeGraphic.fontSize}px</span>
                      </div>
                      <input
                        type="range"
                        min={18}
                        max={100}
                        value={activeGraphic.fontSize}
                        onChange={(e) =>
                          onUpdateGraphic(activeGraphic.id, {
                            fontSize: Number(e.target.value),
                          })
                        }
                        className="w-full"
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-[#7F869B]">
                    No text layer selected. Add a title from the left Graphics panel.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM PANEL: Complete Interactive Multitrack Timeline */}
      <div className="h-[290px] shrink-0">
        <MultitrackTimeline
          project={project}
          currentTimeSec={currentTimeSec}
          selectedShotId={activeShot?.id || null}
          selectedGraphicId={selectedGraphicId}
          selectedEffectId={selectedEffectId}
          onSeek={onTimeUpdate}
          onSelectShot={(id) => {
            onSelectShot(id);
            setRightTab('clip');
          }}
          onSelectGraphic={(id) => {
            onSelectGraphic(id);
            setRightTab('text');
          }}
          onSelectEffect={onSelectEffect}
          onSplitAtPlayhead={onSplitAtPlayhead}
          onToggleTrackMute={onToggleTrackMute}
          onTrimShotBoundary={onTrimShotBoundary}
        />
      </div>
    </div>
  );
};

/* ===================== EXPANDED TIMELINE FOCUS VIEW ===================== */

export const TimelineEditorView: React.FC<
  Pick<
    ReconstructionEditorViewProps,
    | 'project'
    | 'videoUrl'
    | 'currentTimeSec'
    | 'isPlaying'
    | 'selectedShotId'
    | 'selectedGraphicId'
    | 'selectedEffectId'
    | 'onSelectShot'
    | 'onSelectGraphic'
    | 'onSelectEffect'
    | 'onTimeUpdate'
    | 'onTogglePlay'
    | 'onStepFrame'
    | 'onSplitAtPlayhead'
    | 'onToggleTrackMute'
    | 'onTrimShotBoundary'
  >
> = (props) => {
  return (
    <div className="h-[calc(100vh-56px)] flex flex-col p-4 gap-4 bg-[#0C0D11] overflow-hidden">
      <div className="h-[230px] shrink-0 grid grid-cols-12 gap-4">
        <div className="col-span-5 min-h-0">
          <VideoMonitor
            project={props.project}
            videoUrl={props.videoUrl}
            currentTimeSec={props.currentTimeSec}
            isPlaying={props.isPlaying}
            viewMode="reconstructed"
            onTimeUpdate={props.onTimeUpdate}
            onTogglePlay={props.onTogglePlay}
            onStepFrame={props.onStepFrame}
            compact
          />
        </div>
        <div className="col-span-7 rounded-xl bg-[#101218] border border-white/[0.08] p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-white">
              Frame-Accurate Multitrack Sequence
            </h2>
            <p className="text-[13px] text-[#8E96AC] mt-1">
              Full-width timeline workspace with magnetic beat-grid snapping, live split-at-playhead
              razor editing, and direct track mute controls.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-4 pt-3 border-t border-white/[0.08] font-mono tabular-nums">
            <div>
              <div className="font-sans text-[11px] text-[#7F869B]">Video Tracks</div>
              <div className="text-[18px] text-white font-semibold">V1 – V3</div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-[#7F869B]">Audio Tracks</div>
              <div className="text-[18px] text-[#38BDF8] font-semibold">A1 – A4</div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-[#7F869B]">Timebase</div>
              <div className="text-[18px] text-white font-semibold">{props.project.metadata.fps} fps</div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-[#7F869B]">Total Frames</div>
              <div className="text-[18px] text-[#9B82FF] font-semibold">
                {Math.round(props.project.metadata.durationSec * props.project.metadata.fps)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <MultitrackTimeline
          project={props.project}
          currentTimeSec={props.currentTimeSec}
          selectedShotId={props.selectedShotId}
          selectedGraphicId={props.selectedGraphicId}
          selectedEffectId={props.selectedEffectId}
          onSeek={props.onTimeUpdate}
          onSelectShot={props.onSelectShot}
          onSelectGraphic={props.onSelectGraphic}
          onSelectEffect={props.onSelectEffect}
          onSplitAtPlayhead={props.onSplitAtPlayhead}
          onToggleTrackMute={props.onToggleTrackMute}
          onTrimShotBoundary={props.onTrimShotBoundary}
          expanded
        />
      </div>
    </div>
  );
};
