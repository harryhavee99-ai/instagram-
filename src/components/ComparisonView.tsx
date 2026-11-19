import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ColorGradeSettings, ReelProject } from '../types/project';
import { MonitorViewMode, VideoMonitor } from './VideoMonitor';

interface ComparisonViewProps {
  project: ReelProject;
  videoUrl: string | null;
  currentTimeSec: number;
  isPlaying: boolean;
  onTimeUpdate: (t: number) => void;
  onTogglePlay: () => void;
  onStepFrame: (dt: number) => void;
  onSnapAllCutsToBeats: () => void;
  onUpdateColorGrade: (next: ColorGradeSettings) => void;
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({
  project,
  videoUrl,
  currentTimeSec,
  isPlaying,
  onTimeUpdate,
  onTogglePlay,
  onStepFrame,
  onSnapAllCutsToBeats,
  onUpdateColorGrade,
}) => {
  const [mode, setMode] = useState<MonitorViewMode>('split');
  const { comparison } = project;

  const metricRows = [
    {
      label: 'Shot Timing Accuracy',
      score: comparison.shotTimingScore,
      detail: 'Clip boundary continuity & duration coverage',
    },
    {
      label: 'Transition Timing',
      score: comparison.transitionTimingScore,
      detail: 'Native Premiere transition mapping fidelity',
    },
    {
      label: 'Color Similarity',
      score: comparison.colorSimilarityScore,
      detail: 'RGB histogram & tone match confidence',
    },
    {
      label: 'Motion Similarity',
      score: comparison.motionSimilarityScore,
      detail: 'Keyframe motion match vs CV frame deltas',
    },
    {
      label: 'Audio Synchronization',
      score: project.audio.hasAudio ? comparison.audioSyncScore : null,
      detail: project.audio.hasAudio
        ? `Cut alignment to ${project.audio.estimatedBpm} BPM grid`
        : 'No decodable audio stream in source media',
    },
  ];

  return (
    <div className="max-w-[1200px] mx-auto px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-[26px] font-semibold text-white">
            Original vs Reconstructed Comparison
          </h1>
          <p className="text-[14px] text-[#A5ACBF]">
            Synchronized split-screen and side-by-side playback with measurable timeline, motion,
            color, and beat-sync verification metrics.
          </p>
        </div>

        <button
          type="button"
          onClick={onSnapAllCutsToBeats}
          disabled={!project.audio.hasAudio || project.audio.beats.length === 0}
          className="px-4 py-2 rounded-lg bg-[#1A1D26] hover:bg-[#232736] border border-white/[0.1] text-[13px] font-medium text-white disabled:opacity-40 inline-flex items-center gap-2 whitespace-nowrap"
        >
          <RefreshCw className="w-3.5 h-3.5 text-[#38BDF8]" />
          <span>Re-Align Cuts to Nearest Beats</span>
        </button>
      </div>

      {/* Synchronized Comparison Monitor */}
      <div className="h-[470px]">
        <VideoMonitor
          project={project}
          videoUrl={videoUrl}
          currentTimeSec={currentTimeSec}
          isPlaying={isPlaying}
          viewMode={mode}
          onViewModeChange={setMode}
          onTimeUpdate={onTimeUpdate}
          onTogglePlay={onTogglePlay}
          onStepFrame={onStepFrame}
        />
      </div>

      {/* Measured Comparison Scores & Live Calibration */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[16px] font-semibold text-white">
                Measured Reconstruction Similarity
              </h2>
              <p className="text-[12px] text-[#8E96AC]">
                Computed directly from detected CV cut alignment, histogram confidence, and beat
                offsets.
              </p>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[#7F869B]">Overall Composite</div>
              <div className="text-[26px] font-mono tabular-nums font-semibold text-[#9B82FF]">
                {comparison.overallSimilarityScore}%
              </div>
            </div>
          </div>

          <div className="space-y-3.5">
            {metricRows.map((m) => (
              <div key={m.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-[13px]">
                  <div>
                    <span className="font-medium text-white">{m.label}</span>
                    <span className="text-[12px] text-[#7F869B] ml-2">{m.detail}</span>
                  </div>
                  <span className="font-mono tabular-nums font-medium text-white">
                    {m.score === null ? 'N/A' : `${m.score}%`}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[#0B0C10] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#7C5CFF] transition-all duration-200"
                    style={{ width: `${m.score ?? 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t border-white/[0.08] space-y-1 text-[12px] text-[#8E96AC]">
            {comparison.measuredNotes.map((note, idx) => (
              <div key={idx}>• {note}</div>
            ))}
          </div>
        </div>

        {/* Live Reconstruction Calibration Panel */}
        <div className="lg:col-span-4 rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4">
          <h2 className="text-[15px] font-semibold text-white">Fine-Tune Match</h2>
          <p className="text-[12px] text-[#8E96AC]">
            Adjust reconstructed look parameters while watching the Split-Screen monitor above.
          </p>

          {(
            [
              ['exposure', 'Exposure (EV)', -1.5, 1.5, 0.05],
              ['contrast', 'Contrast', -60, 60, 1],
              ['temperature', 'Temperature', -60, 60, 1],
              ['saturation', 'Saturation (%)', 40, 180, 1],
              ['vignette', 'Vignette (%)', 0, 80, 1],
            ] as const
          ).map(([key, label, min, max, step]) => (
            <div key={key} className="space-y-1 text-[12px]">
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
      </div>
    </div>
  );
};
