import React, { useMemo, useRef, useState } from 'react';
import {
  Magnet,
  Scissors,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ReelProject } from '../types/project';
import { clamp, formatSmpte } from '../engine/formatters';

interface MultitrackTimelineProps {
  project: ReelProject;
  currentTimeSec: number;
  selectedShotId: string | null;
  selectedGraphicId: string | null;
  selectedEffectId: string | null;
  onSeek: (timeSec: number) => void;
  onSelectShot: (shotId: string) => void;
  onSelectGraphic: (gfxId: string) => void;
  onSelectEffect: (fxId: string) => void;
  onSplitAtPlayhead?: () => void;
  onToggleTrackMute?: (trackId: 'A1' | 'A2' | 'A3' | 'A4') => void;
  onTrimShotBoundary?: (shotId: string, edge: 'start' | 'end', newTimeSec: number) => void;
  expanded?: boolean;
}

export const MultitrackTimeline: React.FC<MultitrackTimelineProps> = ({
  project,
  currentTimeSec,
  selectedShotId,
  selectedGraphicId,
  selectedEffectId,
  onSeek,
  onSelectShot,
  onSelectGraphic,
  onSelectEffect,
  onSplitAtPlayhead,
  onToggleTrackMute,
  onTrimShotBoundary,
  expanded = false,
}) => {
  const [zoom, setZoom] = useState(1);
  const [snapToBeat, setSnapToBeat] = useState(true);
  const trackContainerRef = useRef<HTMLDivElement | null>(null);

  const duration = Math.max(1, project.metadata.durationSec);
  const baseWidthPx = 920;
  const timelineWidthPx = Math.round(baseWidthPx * zoom);
  const pxPerSec = timelineWidthPx / duration;

  const snapTime = (rawSec: number): number => {
    const bounded = clamp(rawSec, 0, duration);
    if (!snapToBeat || project.audio.beats.length === 0) return Number(bounded.toFixed(3));
    let nearest = bounded;
    let bestDiff = 0.09; // 90ms magnetic beat snap
    for (const b of project.audio.beats) {
      const diff = Math.abs(b.timeSec - bounded);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = b.timeSec;
      }
    }
    return Number(nearest.toFixed(3));
  };

  const handleRulerPointer = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = clamp(e.clientX - rect.left, 0, rect.width);
    const sec = (x / rect.width) * duration;
    onSeek(snapTime(sec));
  };

  const rulerTicks = useMemo(() => {
    const step = duration <= 12 ? 1 : duration <= 30 ? 2 : 5;
    const ticks: number[] = [];
    for (let t = 0; t <= duration; t += step) {
      ticks.push(Number(t.toFixed(1)));
    }
    return ticks;
  }, [duration]);

  const playheadLeftPx = clamp(currentTimeSec * pxPerSec, 0, timelineWidthPx);

  return (
    <div className="flex flex-col bg-[#08090C] rounded-xl border border-white/[0.08] overflow-hidden h-full">
      {/* Timeline Toolbar */}
      <div className="h-10 px-3.5 border-b border-white/[0.08] bg-[#101218] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 text-[12px]">
          <span className="font-medium text-white">Multitrack Timeline</span>
          <span className="text-[#4B5164]" aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-[#9B82FF]">
            {formatSmpte(currentTimeSec, project.metadata.fps)}
          </span>
          <span className="text-[#4B5164]" aria-hidden="true">·</span>
          <span className="text-[#8E96AC] font-mono tabular-nums">
            {project.shots.length} clips · {project.audio.beats.length} beat markers
          </span>
        </div>

        <div className="flex items-center gap-2">
          {onSplitAtPlayhead && (
            <button
              type="button"
              onClick={onSplitAtPlayhead}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium bg-[#181B24] hover:bg-[#232736] text-[#D4D8E3] border border-white/[0.08] transition-colors whitespace-nowrap"
            >
              <Scissors className="w-3.5 h-3.5 text-[#9B82FF]" />
              <span>Split at Playhead</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setSnapToBeat((s) => !s)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium border transition-colors whitespace-nowrap ${
              snapToBeat
                ? 'bg-[#3B82F6]/20 text-[#93C5FD] border-[#3B82F6]/40'
                : 'bg-[#181B24] text-[#8E96AC] border-white/[0.08] hover:text-white'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Snap to Beat</span>
          </button>

          <div className="flex items-center gap-1 ml-1">
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(Number((z - 0.35).toFixed(2)), 0.75, 4))}
              title="Zoom out timeline"
              className="p-1.5 rounded-md text-[#8E96AC] hover:text-white hover:bg-white/[0.06]"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono tabular-nums text-[#8E96AC] w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => clamp(Number((z + 0.35).toFixed(2)), 0.75, 4))}
              title="Zoom in timeline"
              className="p-1.5 rounded-md text-[#8E96AC] hover:text-white hover:bg-white/[0.06]"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Scrollable Multitrack Grid */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Track Headers */}
        <div className="w-[152px] shrink-0 bg-[#101218] border-r border-white/[0.08] flex flex-col">
          {/* Ruler header corner */}
          <div className="h-7 border-b border-white/[0.08] px-3 flex items-center text-[11px] font-mono text-[#6E768C]">
            {project.metadata.fps} fps
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
            {/* Video Tracks */}
            <div className={`${expanded ? 'h-12' : 'h-9'} px-3 flex items-center justify-between text-[12px]`}>
              <span className="font-mono text-[#9B82FF] text-[11px]">V3</span>
              <span className="text-[#A5ACBF] truncate ml-2 flex-1">Titles & GFX</span>
            </div>
            <div className={`${expanded ? 'h-12' : 'h-9'} px-3 flex items-center justify-between text-[12px]`}>
              <span className="font-mono text-[#3B82F6] text-[11px]">V2</span>
              <span className="text-[#A5ACBF] truncate ml-2 flex-1">Effects Layer</span>
            </div>
            <div className={`${expanded ? 'h-16' : 'h-13'} px-3 flex items-center justify-between text-[12px]`}>
              <span className="font-mono text-[#7C5CFF] text-[11px]">V1</span>
              <span className="text-white font-medium truncate ml-2 flex-1">Main Video</span>
            </div>

            {/* Audio Tracks */}
            {project.audio.tracks.map((tr) => (
              <div
                key={tr.id}
                className={`${expanded ? 'h-12' : 'h-10'} px-3 flex items-center justify-between gap-1.5 text-[12px]`}
              >
                <span className="font-mono text-[#38BDF8] text-[11px]">{tr.id}</span>
                <span className="text-[#A5ACBF] truncate flex-1">{tr.role}</span>
                {onToggleTrackMute && (
                  <button
                    type="button"
                    onClick={() => onToggleTrackMute(tr.id)}
                    title={tr.muted ? 'Unmute track' : 'Mute track'}
                    className={`p-1 rounded ${
                      tr.muted ? 'text-[#EF4444]' : 'text-[#6E768C] hover:text-white'
                    }`}
                  >
                    {tr.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right Scrollable Lanes */}
        <div
          ref={trackContainerRef}
          className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#08090C]"
        >
          <div style={{ width: `${timelineWidthPx}px` }} className="relative min-h-full">
            {/* Timecode Ruler & Beat Markers */}
            <div
              onClick={handleRulerPointer}
              className="h-7 border-b border-white/[0.08] bg-[#0F1117] relative cursor-pointer select-none"
            >
              {rulerTicks.map((sec) => (
                <div
                  key={sec}
                  className="absolute top-0 bottom-0 border-l border-white/[0.1] pl-1 text-[10px] font-mono tabular-nums text-[#7F869B] flex items-center"
                  style={{ left: `${sec * pxPerSec}px` }}
                >
                  {sec}s
                </div>
              ))}
              {/* Beat diamond ticks along bottom of ruler */}
              {project.audio.beats.map((b) => (
                <div
                  key={b.id}
                  title={`${b.isDownbeat ? 'Downbeat' : 'Beat'} Bar ${b.barNumber}.${b.beatInBar} (${b.timeSec.toFixed(2)}s)`}
                  className={`absolute bottom-0 w-1.5 h-1.5 rotate-45 -translate-x-1/2 ${
                    b.isDownbeat ? 'bg-[#3B82F6]' : 'bg-[#7C5CFF]/60'
                  }`}
                  style={{ left: `${b.timeSec * pxPerSec}px` }}
                />
              ))}
            </div>

            {/* Subtle vertical beat gridlines across lanes */}
            <div className="pointer-events-none absolute top-7 bottom-0 left-0 right-0">
              {project.audio.beats.map((b) => (
                <div
                  key={`grid-${b.id}`}
                  className={`absolute top-0 bottom-0 border-l ${
                    b.isDownbeat ? 'border-[#3B82F6]/20' : 'border-white/[0.03]'
                  }`}
                  style={{ left: `${b.timeSec * pxPerSec}px` }}
                />
              ))}
            </div>

            {/* Track Lanes */}
            <div className="divide-y divide-white/[0.06] relative">
              {/* V3: Titles & Motion Graphics */}
              <div className={`${expanded ? 'h-12' : 'h-9'} relative`}>
                {project.motionGraphics.map((g) => {
                  const left = g.startTimeSec * pxPerSec;
                  const width = Math.max(24, (g.endTimeSec - g.startTimeSec) * pxPerSec);
                  const active = selectedGraphicId === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onSelectGraphic(g.id)}
                      style={{ left: `${left}px`, width: `${width}px` }}
                      className={`absolute top-1 bottom-1 rounded px-2 text-left text-[11px] font-medium truncate border transition-colors ${
                        active
                          ? 'bg-[#A855F7]/35 border-[#C084FC] text-white'
                          : 'bg-[#A855F7]/18 border-[#A855F7]/40 text-[#E9D5FF] hover:bg-[#A855F7]/28'
                      }`}
                    >
                      {g.text}
                    </button>
                  );
                })}
              </div>

              {/* V2: Effects & Adjustment Layers */}
              <div className={`${expanded ? 'h-12' : 'h-9'} relative`}>
                {project.effects.map((ef) => {
                  const left = ef.startTimeSec * pxPerSec;
                  const width = Math.max(22, (ef.endTimeSec - ef.startTimeSec) * pxPerSec);
                  const active = selectedEffectId === ef.id;
                  return (
                    <button
                      key={ef.id}
                      type="button"
                      onClick={() => onSelectEffect(ef.id)}
                      style={{ left: `${left}px`, width: `${width}px` }}
                      className={`absolute top-1 bottom-1 rounded px-2 text-left text-[11px] truncate border transition-colors ${
                        active
                          ? 'bg-[#3B82F6]/35 border-[#60A5FA] text-white'
                          : 'bg-[#3B82F6]/16 border-[#3B82F6]/40 text-[#BFDBFE] hover:bg-[#3B82F6]/26'
                      }`}
                    >
                      {ef.name}
                    </button>
                  );
                })}
              </div>

              {/* V1: Main Video Clips + Keyframes + Transition markers */}
              <div className={`${expanded ? 'h-16' : 'h-13'} relative`}>
                {project.shots.map((shot) => {
                  const left = shot.startTimeSec * pxPerSec;
                  const width = Math.max(20, (shot.endTimeSec - shot.startTimeSec) * pxPerSec);
                  const active = selectedShotId === shot.id;
                  return (
                    <div
                      key={shot.id}
                      style={{ left: `${left}px`, width: `${width}px` }}
                      className="absolute top-1 bottom-1 group"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectShot(shot.id);
                          onSeek(shot.startTimeSec);
                        }}
                        className={`w-full h-full rounded overflow-hidden border text-left relative flex items-center px-2 gap-2 transition-colors ${
                          active
                            ? 'bg-[#7C5CFF]/30 border-[#9B82FF] text-white'
                            : 'bg-[#1D2130] border-white/[0.12] text-[#D4D8E3] hover:border-[#7C5CFF]/60'
                        }`}
                      >
                        {shot.thumbnailDataUrl && width > 65 && (
                          <img
                            src={shot.thumbnailDataUrl}
                            alt=""
                            referrerPolicy="no-referrer"
                            className="h-full w-8 object-cover rounded-sm shrink-0 opacity-85"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] font-medium truncate leading-tight">
                            {shot.name}
                          </div>
                          <div className="text-[10px] font-mono tabular-nums text-[#8E96AC] truncate">
                            {shot.durationSec.toFixed(2)}s · {shot.speedPercent}%
                          </div>
                        </div>
                        {/* Keyframe diamonds inside clip */}
                        {shot.keyframes.map((kf) => (
                          <span
                            key={kf.id}
                            title={`Keyframe: ${kf.property} = ${kf.value}`}
                            className="pointer-events-none absolute bottom-1 w-1.5 h-1.5 bg-[#FBBF24] rotate-45"
                            style={{
                              left: `${clamp((kf.timeSec / Math.max(0.05, shot.durationSec)) * 100, 4, 96)}%`,
                            }}
                          />
                        ))}
                      </button>

                      {/* Trim right handle for quick frame-accurate adjustment */}
                      {onTrimShotBoundary && shot.index < project.shots.length - 1 && (
                        <button
                          type="button"
                          title="Nudge cut +0.1s"
                          onClick={(e) => {
                            e.stopPropagation();
                            onTrimShotBoundary(shot.id, 'end', shot.endTimeSec + 0.1);
                          }}
                          className="absolute top-0 bottom-0 -right-1 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-[#9B82FF]/70 rounded-r"
                        />
                      )}

                      {/* Transition indicator at right cut boundary */}
                      {shot.transitionOut.type !== 'Cut' && (
                        <div
                          title={`Transition: ${shot.transitionOut.type} (${shot.transitionOut.durationSec}s)`}
                          className="pointer-events-none absolute -right-2 top-1/2 -translate-y-1/2 z-10 px-1 py-0.5 rounded bg-[#0C0D11] border border-[#3B82F6]/60 text-[9px] font-mono text-[#93C5FD]"
                        >
                          T
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* A1: Original Audio Waveform */}
              <div
                onClick={handleRulerPointer}
                className={`${expanded ? 'h-12' : 'h-10'} relative cursor-pointer overflow-hidden`}
              >
                <div className="absolute inset-y-1 left-0 right-0 bg-[#0F2438]/60 border border-[#38BDF8]/30 rounded flex items-center px-0.5 gap-[1px]">
                  {project.audio.waveformPeaks.map((peak, idx) => (
                    <div
                      key={idx}
                      className="flex-1 bg-[#38BDF8]/75 rounded-[1px]"
                      style={{
                        height: `${Math.max(8, Math.round(peak * 88))}%`,
                        opacity: project.audio.tracks[0]?.muted ? 0.25 : 0.85,
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* A2: Background Music Reference Sections */}
              <div className={`${expanded ? 'h-12' : 'h-10'} relative`}>
                {project.audio.sections.map((sec, idx) => {
                  const left = sec.startTimeSec * pxPerSec;
                  const width = Math.max(24, (sec.endTimeSec - sec.startTimeSec) * pxPerSec);
                  return (
                    <div
                      key={`${sec.name}-${idx}`}
                      style={{ left: `${left}px`, width: `${width}px` }}
                      className="absolute top-1 bottom-1 rounded bg-[#15283B] border border-[#3B82F6]/30 px-2 flex items-center justify-between text-[11px] text-[#93C5FD] overflow-hidden"
                    >
                      <span className="truncate font-medium">{sec.name}</span>
                      <span className="font-mono text-[10px] text-[#60A5FA] shrink-0 ml-1">
                        {sec.energyLevel}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* A3: Sound Effects Cues */}
              <div className={`${expanded ? 'h-12' : 'h-10'} relative`}>
                {project.audio.sfxEvents.map((sfx) => {
                  const left = sfx.timeSec * pxPerSec;
                  const width = Math.max(44, sfx.durationSec * pxPerSec);
                  return (
                    <button
                      key={sfx.id}
                      type="button"
                      onClick={() => onSeek(sfx.timeSec)}
                      style={{ left: `${left}px`, width: `${width}px` }}
                      className="absolute top-1 bottom-1 rounded bg-[#16A34A]/20 border border-[#16A34A]/45 px-1.5 text-left text-[10px] text-[#86EFAC] truncate hover:bg-[#16A34A]/30"
                    >
                      {sfx.label}
                    </button>
                  );
                })}
              </div>

              {/* A4: Voiceover Cue */}
              <div className={`${expanded ? 'h-12' : 'h-10'} relative flex items-center px-3`}>
                {project.audio.voiceoverDetected ? (
                  <div className="h-7 w-full rounded bg-[#D97706]/20 border border-[#D97706]/45 px-2.5 flex items-center text-[11px] text-[#FDE68A]">
                    Detected speech / voiceover presence ({project.audio.voiceoverNotes})
                  </div>
                ) : (
                  <span className="text-[11px] text-[#4E5569]">
                    No separate voiceover segment detected — reserved for dialogue replacement
                  </span>
                )}
              </div>
            </div>

            {/* Vertical Playhead */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-[1.5px] bg-[#7C5CFF] z-20"
              style={{ left: `${playheadLeftPx}px` }}
            >
              <div className="w-3 h-3 -ml-[5.25px] bg-[#7C5CFF] rounded-b-sm" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
