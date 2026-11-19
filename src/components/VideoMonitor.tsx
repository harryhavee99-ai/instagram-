import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ReelProject, ShotClip } from '../types/project';
import { hexToRgba } from '../engine/captionPresets';
import { buildColorFilterCss, clamp, formatSmpte } from '../engine/formatters';

export type MonitorViewMode = 'original' | 'reconstructed' | 'split' | 'side-by-side';

interface VideoMonitorProps {
  project: ReelProject;
  videoUrl: string | null;
  currentTimeSec: number;
  isPlaying: boolean;
  viewMode: MonitorViewMode;
  onViewModeChange?: (mode: MonitorViewMode) => void;
  onTimeUpdate: (timeSec: number) => void;
  onTogglePlay: () => void;
  onStepFrame?: (deltaSec: number) => void;
  compact?: boolean;
}

function computeShotTransform(shot: ShotClip | undefined, currentTimeSec: number) {
  if (!shot) {
    return { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, flashOpacity: 0, blurPx: 0 };
  }
  const relTime = clamp(currentTimeSec - shot.startTimeSec, 0, Math.max(0.01, shot.durationSec));
  let scalePct = shot.scale;

  const scaleKfs = shot.keyframes
    .filter((k) => k.property === 'scale')
    .sort((a, b) => a.timeSec - b.timeSec);

  if (scaleKfs.length >= 2) {
    const first = scaleKfs[0];
    const last = scaleKfs[scaleKfs.length - 1];
    const span = Math.max(0.01, last.timeSec - first.timeSec);
    const t = clamp((relTime - first.timeSec) / span, 0, 1);
    scalePct = first.value + (last.value - first.value) * t;
  }

  let opacity = shot.opacity / 100;
  let flashOpacity = 0;
  let blurPx = 0;

  // Apply transition preview near end of shot
  const rem = shot.endTimeSec - currentTimeSec;
  const transDur = shot.transitionOut.durationSec;
  if (transDur > 0 && rem >= 0 && rem <= transDur) {
    const p = 1 - rem / transDur; // 0 -> 1
    const tType = shot.transitionOut.type;
    if (tType === 'Cross Dissolve' || tType === 'Fade Out') {
      opacity *= 1 - p * 0.75;
    } else if (tType === 'Flash Transition' || tType === 'Light Leak') {
      flashOpacity = Math.sin(p * Math.PI) * (shot.transitionOut.intensity / 100) * 0.85;
    } else if (tType === 'Zoom Transition') {
      scalePct += p * (shot.transitionOut.intensity * 0.35);
      blurPx = p * 5;
    } else if (tType === 'Blur Transition' || tType === 'Whip Pan') {
      blurPx = Math.sin(p * Math.PI) * 8;
    }
  }

  return {
    scale: scalePct / 100,
    x: shot.positionX * 0.25,
    y: shot.positionY * 0.25,
    rotation: shot.rotation,
    opacity: clamp(opacity, 0.05, 1),
    flashOpacity,
    blurPx,
  };
}

export const VideoMonitor: React.FC<VideoMonitorProps> = ({
  project,
  videoUrl,
  currentTimeSec,
  isPlaying,
  viewMode,
  onViewModeChange,
  onTimeUpdate,
  onTogglePlay,
  onStepFrame,
  compact = false,
}) => {
  const origVideoRef = useRef<HTMLVideoElement | null>(null);
  const reconVideoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [splitPercent, setSplitPercent] = useState(50);

  const activeShot = useMemo(
    () =>
      project.shots.find(
        (s) => currentTimeSec >= s.startTimeSec && currentTimeSec <= s.endTimeSec
      ) || project.shots[0],
    [project.shots, currentTimeSec]
  );

  const activeGraphics = useMemo(
    () =>
      project.motionGraphics.filter(
        (g) => currentTimeSec >= g.startTimeSec && currentTimeSec <= g.endTimeSec
      ),
    [project.motionGraphics, currentTimeSec]
  );

  const colorCss = useMemo(
    () => buildColorFilterCss(project.colorGrade),
    [project.colorGrade]
  );

  const transform = useMemo(
    () => computeShotTransform(activeShot, currentTimeSec),
    [activeShot, currentTimeSec]
  );

  const a1Track = project.audio.tracks.find((t) => t.id === 'A1');

  // Synchronize HTML5 video elements with playhead & play state
  useEffect(() => {
    const v1 = origVideoRef.current;
    const v2 = reconVideoRef.current;
    const targets = [v1, v2].filter(Boolean) as HTMLVideoElement[];

    for (const v of targets) {
      if (Math.abs(v.currentTime - currentTimeSec) > 0.14) {
        v.currentTime = clamp(currentTimeSec, 0, Math.max(0.05, project.metadata.durationSec - 0.02));
      }
      if (v === reconVideoRef.current && activeShot) {
        v.playbackRate = clamp(activeShot.speedPercent / 100, 0.25, 4);
      } else {
        v.playbackRate = 1;
      }
    }
  }, [currentTimeSec, activeShot, project.metadata.durationSec]);

  useEffect(() => {
    const v1 = origVideoRef.current;
    const v2 = reconVideoRef.current;
    const targets = [v1, v2].filter(Boolean) as HTMLVideoElement[];

    if (isPlaying) {
      for (const v of targets) {
        v.play().catch(() => {});
      }
    } else {
      for (const v of targets) {
        v.pause();
      }
    }
  }, [isPlaying, viewMode]);

  // Fallback rAF playback clock if no local video blob URL is mounted (e.g. reopened history project)
  useEffect(() => {
    if (!isPlaying || videoUrl) return;
    let rafId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = currentTimeSec + dt;
      if (next >= project.metadata.durationSec) {
        onTimeUpdate(0);
      } else {
        onTimeUpdate(next);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, videoUrl, currentTimeSec, project.metadata.durationSec, onTimeUpdate]);

  // Keep volume in sync with A1 track + mute button
  useEffect(() => {
    const primary = origVideoRef.current || reconVideoRef.current;
    if (!primary) return;
    const db = a1Track ? a1Track.volumeDb : 0;
    const gain = a1Track?.muted || muted ? 0 : clamp(Math.pow(10, db / 20), 0, 1);
    primary.volume = gain;
    primary.muted = muted || Boolean(a1Track?.muted);
    if (reconVideoRef.current && origVideoRef.current) {
      reconVideoRef.current.muted = true; // prevent double audio
    }
  }, [muted, a1Track, viewMode]);

  const isVertical = project.metadata.height > project.metadata.width;
  const aspectStyle: React.CSSProperties = {
    aspectRatio: `${project.metadata.width} / ${project.metadata.height}`,
  };

  const renderVideoOrThumb = (
    refObj: React.RefObject<HTMLVideoElement | null>,
    isMasterClock: boolean,
    styledRecon: boolean
  ) => {
    const reconStyle: React.CSSProperties = styledRecon
      ? {
          filter: `${colorCss}${transform.blurPx > 0.2 ? ` blur(${transform.blurPx.toFixed(1)}px)` : ''}`,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale.toFixed(3)}) rotate(${transform.rotation}deg)`,
          opacity: transform.opacity,
          transition: 'transform 80ms linear',
        }
      : {};

    return (
      <div className="relative w-full h-full overflow-hidden bg-black">
        {videoUrl ? (
          <video
            ref={refObj}
            src={videoUrl}
            playsInline
            muted={!isMasterClock || muted}
            onTimeUpdate={
              isMasterClock
                ? (e) => {
                    const t = e.currentTarget.currentTime;
                    if (t >= project.metadata.durationSec - 0.04) {
                      e.currentTarget.currentTime = 0;
                      onTimeUpdate(0);
                    } else {
                      onTimeUpdate(t);
                    }
                  }
                : undefined
            }
            className="w-full h-full object-contain"
            style={reconStyle}
          />
        ) : activeShot?.thumbnailDataUrl ? (
          <img
            src={activeShot.thumbnailDataUrl}
            alt={activeShot.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain"
            style={reconStyle}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[12px] text-[#6E768C]">
            Source media preview unavailable
          </div>
        )}

        {/* Reconstructed Vignette & Fade/Flash Overlays */}
        {styledRecon && project.colorGrade.vignette > 4 && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(circle, transparent 42%, rgba(0,0,0,${(
                project.colorGrade.vignette / 135
              ).toFixed(2)}) 100%)`,
            }}
          />
        )}

        {styledRecon && transform.flashOpacity > 0.02 && (
          <div
            className="pointer-events-none absolute inset-0 bg-white"
            style={{ opacity: transform.flashOpacity }}
          />
        )}

        {/* Reconstructed Editable Captions & Motion Graphics Layer (Track V3) */}
        {styledRecon &&
          activeGraphics.map((g) => {
            const cueDur = Math.max(0.15, g.endTimeSec - g.startTimeSec);
            const rel = clamp(currentTimeSec - g.startTimeSec, 0, cueDur);
            const animP = clamp(rel / Math.max(0.05, g.animationDurationSec || 0.28), 0, 1);

            const gOpacity =
              g.animationType === 'Fade' || g.animationType === 'Slide Up' ? animP : 1;

            let gScale = 1;
            if (g.animationType === 'Bounce Pop') {
              // Elastic spring overshoot: 0.62 -> 1.14 -> 1.0
              gScale =
                animP < 0.65
                  ? 0.62 + (animP / 0.65) * 0.52
                  : 1.14 - ((animP - 0.65) / 0.35) * 0.14;
            } else if (g.animationType === 'Pop In' || g.animationType === 'Kinetic Scale') {
              const eased = 1 - Math.pow(1 - animP, 3);
              gScale = 0.78 + eased * 0.22;
            }

            const gTranslateY =
              g.animationType === 'Slide Up' ? (1 - (1 - Math.pow(1 - animP, 2))) * 22 : 0;

            const isNeon =
              g.captionStylePreset === 'Neon Glow' || g.animationType === 'Glow Pulse';
            const pulseGlow = isNeon ? 10 + Math.sin(rel * 8) * 5 : 0;

            const textShadow = isNeon
              ? `0 0 ${Math.round(pulseGlow)}px ${g.outlineColorHex || '#7C5CFF'}, 0 0 ${Math.round(pulseGlow * 2)}px ${g.highlightColorHex || '#38BDF8'}, 0 2px 6px rgba(0,0,0,0.85)`
              : g.hasShadow
              ? '0 3px 12px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.95)'
              : 'none';

            const bgRgba = hexToRgba(g.backgroundColorHex, g.backgroundOpacity);
            const hasBg = (g.backgroundOpacity ?? 0) > 0;
            const strokePx = Math.max(
              0,
              Number(((g.outlineWidthPx ?? 2) * (compact ? 0.32 : 0.45)).toFixed(2))
            );

            const rawText = g.text.trim();
            const fullText =
              g.textTransform === 'uppercase'
                ? rawText.toUpperCase()
                : g.textTransform === 'capitalize'
                ? rawText.replace(/\b\w/g, (c) => c.toUpperCase())
                : rawText;

            const displayString =
              g.animationType === 'Typewriter'
                ? fullText.slice(
                    0,
                    Math.max(1, Math.ceil((rel / Math.max(0.25, cueDur * 0.75)) * fullText.length))
                  )
                : fullText;

            const words = displayString.split(/\s+/).filter(Boolean);
            const activeKaraokeIndex =
              g.animationType === 'Karaoke Sweep' && words.length > 0
                ? Math.min(words.length - 1, Math.floor((rel / cueDur) * words.length))
                : -1;
            const normHighlight = g.highlightWord
              ? g.highlightWord.trim().toLowerCase().replace(/[^a-z0-9]/gi, '')
              : '';

            return (
              <div
                key={g.id}
                className="pointer-events-none absolute text-center select-none"
                style={{
                  left: `${g.positionXPercent}%`,
                  top: `${g.positionYPercent}%`,
                  maxWidth: '88%',
                  transform: `translate(-50%, -50%) translateY(${gTranslateY.toFixed(1)}px) scale(${gScale.toFixed(3)})`,
                  opacity: gOpacity,
                  color: g.colorHex,
                  fontFamily: `${g.fontFamily}, Outfit, sans-serif`,
                  fontWeight: g.fontWeight,
                  fontSize: `${Math.max(12, Math.round(g.fontSize * (compact ? 0.4 : 0.54)))}px`,
                  textShadow,
                  WebkitTextStroke:
                    strokePx > 0 && g.outlineColorHex
                      ? `${strokePx}px ${g.outlineColorHex}`
                      : undefined,
                  paintOrder: 'stroke fill',
                  backgroundColor: hasBg ? bgRgba : 'transparent',
                  padding: hasBg ? (compact ? '3px 8px' : '5px 12px') : '0 6px',
                  borderRadius: hasBg ? '8px' : undefined,
                  lineHeight: 1.18,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {words.length > 0 &&
                (g.animationType === 'Karaoke Sweep' ||
                  g.animationType === 'Word Highlight' ||
                  normHighlight.length > 0) ? (
                  words.map((word, wIdx) => {
                    const cleanWord = word.toLowerCase().replace(/[^a-z0-9]/gi, '');
                    const isKaraokeHit =
                      g.animationType === 'Karaoke Sweep' && wIdx === activeKaraokeIndex;
                    const isKeywordHit = normHighlight.length > 0 && cleanWord === normHighlight;
                    const isActiveWord = isKaraokeHit || isKeywordHit;

                    return (
                      <React.Fragment key={`${g.id}-w-${wIdx}`}>
                        <span
                          style={{
                            color: isActiveWord ? g.highlightColorHex || '#FACC15' : undefined,
                            display: 'inline-block',
                            transform: isActiveWord ? 'scale(1.08)' : 'scale(1)',
                            transition: 'transform 90ms ease-out, color 90ms ease-out',
                          }}
                        >
                          {word}
                        </span>
                        {wIdx < words.length - 1 ? ' ' : ''}
                      </React.Fragment>
                    );
                  })
                ) : (
                  displayString
                )}
              </div>
            );
          })}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#08090C] rounded-xl border border-white/[0.08] overflow-hidden">
      {/* Monitor Header Bar */}
      <div className="h-10 px-3.5 border-b border-white/[0.08] bg-[#101218] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 text-[12px] text-[#8E96AC] min-w-0">
          <span className="font-medium text-white truncate">
            {activeShot ? `${activeShot.name} (${activeShot.shotType})` : 'Program Monitor'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-[#9B82FF]">
            {formatSmpte(currentTimeSec, project.metadata.fps)}
          </span>
        </div>

        {onViewModeChange && (
          <div className="flex items-center gap-0.5 p-0.5 bg-[#0C0D11] rounded-lg border border-white/[0.06]">
            {(
              [
                ['original', 'Original'],
                ['reconstructed', 'Reconstructed'],
                ['split', 'Split'],
                ['side-by-side', 'Side by Side'],
              ] as Array<[MonitorViewMode, string]>
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => onViewModeChange(mode)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                  viewMode === mode
                    ? 'bg-[#7C5CFF] text-white'
                    : 'text-[#8E96AC] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Monitor Canvas Viewport */}
      <div className="flex-1 min-h-0 flex items-center justify-center p-3 overflow-hidden relative bg-[#07080A]">
        {viewMode === 'side-by-side' ? (
          <div className="w-full h-full flex items-center justify-center gap-3">
            <div className="flex flex-col items-center h-full justify-center min-w-0">
              <div className="text-[11px] text-[#8E96AC] mb-1.5">Original Source</div>
              <div
                className="relative max-h-[calc(100%-22px)] max-w-full rounded-lg overflow-hidden border border-white/[0.1]"
                style={aspectStyle}
              >
                {renderVideoOrThumb(origVideoRef, true, false)}
              </div>
            </div>
            <div className="flex flex-col items-center h-full justify-center min-w-0">
              <div className="text-[11px] text-[#9B82FF] mb-1.5">Reconstructed Output</div>
              <div
                className="relative max-h-[calc(100%-22px)] max-w-full rounded-lg overflow-hidden border border-[#7C5CFF]/40"
                style={aspectStyle}
              >
                {renderVideoOrThumb(reconVideoRef, false, true)}
              </div>
            </div>
          </div>
        ) : viewMode === 'split' ? (
          <div
            className="relative h-full max-w-full rounded-lg overflow-hidden border border-white/[0.1]"
            style={aspectStyle}
          >
            {/* Base: Reconstructed */}
            <div className="absolute inset-0">
              {renderVideoOrThumb(reconVideoRef, false, true)}
            </div>
            {/* Clipped Overlay: Original */}
            <div
              className="absolute inset-0"
              style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
            >
              {renderVideoOrThumb(origVideoRef, true, false)}
            </div>
            {/* Divider line */}
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-[#7C5CFF]"
              style={{ left: `${splitPercent}%` }}
            />
            <div className="pointer-events-none absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-black/75 text-[11px] text-white">
              Original
            </div>
            <div className="pointer-events-none absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-black/75 text-[11px] text-[#B7A4FF]">
              Reconstructed
            </div>
            <input
              type="range"
              aria-label="Split screen comparison slider"
              min={5}
              max={95}
              value={splitPercent}
              onChange={(e) => setSplitPercent(Number(e.target.value))}
              className="absolute bottom-3 left-3 right-3 z-10 opacity-90"
            />
          </div>
        ) : (
          <div
            className={`relative ${
              isVertical ? 'h-full' : 'w-full max-h-full'
            } max-w-full rounded-lg overflow-hidden border border-white/[0.1]`}
            style={aspectStyle}
          >
            {viewMode === 'original'
              ? renderVideoOrThumb(origVideoRef, true, false)
              : renderVideoOrThumb(reconVideoRef, true, true)}
          </div>
        )}
      </div>

      {/* Transport Controls Footer */}
      <div className="h-11 px-4 border-t border-white/[0.08] bg-[#101218] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onStepFrame?.(-(1 / project.metadata.fps))}
            title="Previous frame"
            className="p-1.5 rounded-md text-[#A5ACBF] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause' : 'Play'}
            className="w-8 h-8 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4BF0] text-white flex items-center justify-center transition-colors"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => onStepFrame?.(1 / project.metadata.fps)}
            title="Next frame"
            className="p-1.5 rounded-md text-[#A5ACBF] hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Scrubber bar */}
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <span className="text-[11px] font-mono tabular-nums text-[#8E96AC] shrink-0">
            {formatSmpte(currentTimeSec, project.metadata.fps)}
          </span>
          <input
            type="range"
            aria-label="Playback position"
            min={0}
            max={project.metadata.durationSec}
            step={0.02}
            value={clamp(currentTimeSec, 0, project.metadata.durationSec)}
            onChange={(e) => onTimeUpdate(Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-[11px] font-mono tabular-nums text-[#6E768C] shrink-0">
            {formatSmpte(project.metadata.durationSec, project.metadata.fps)}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          title={muted ? 'Unmute' : 'Mute'}
          className="p-1.5 rounded-md text-[#A5ACBF] hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
