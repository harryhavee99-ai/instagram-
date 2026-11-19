import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileAudio,
  Film,
  FolderArchive,
  Music,
  Play,
  Sliders,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import type {
  AnalysisPipelineStage,
  AudioEffectItem,
  AudioTrackMix,
  NavPage,
  ReelProject,
} from '../types/project';
import { formatFileSize, formatShortSec, formatSmpte, formatTimecodeMs } from '../engine/formatters';
import {
  generateReconstructionReportMarkdown,
  triggerFileDownload,
} from '../engine/premiereXmlGenerator';

/* ===================== 1. VIDEO ANALYSIS & REPORT VIEW ===================== */

interface VideoAnalysisViewProps {
  project: ReelProject | null;
  pipelineStages: AnalysisPipelineStage[];
  isAnalyzing: boolean;
  analysisError: string | null;
  onNavigate: (page: NavPage) => void;
}

export const VideoAnalysisView: React.FC<VideoAnalysisViewProps> = ({
  project,
  pipelineStages,
  isAnalyzing,
  analysisError,
  onNavigate,
}) => {
  const doneOrWarnCount = pipelineStages.filter(
    (s) => s.status === 'done' || s.status === 'warning'
  ).length;
  const warningStages = pipelineStages.filter((s) => s.status === 'warning');

  return (
    <div className="max-w-[1160px] mx-auto px-8 py-8 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-[26px] font-semibold text-white">
            Video Analysis & Reconstruction Report
          </h1>
          <p className="text-[14px] text-[#A5ACBF]">
            Real-time 11-stage processing telemetry and chronological shot-by-shot technical audit.
          </p>
        </div>

        {project && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                const md = generateReconstructionReportMarkdown(project);
                triggerFileDownload(md, `${project.name}_Reconstruction_Report.md`, 'text/markdown');
              }}
              className="px-3.5 py-2 rounded-lg bg-[#1A1D26] hover:bg-[#232736] border border-white/[0.1] text-[13px] font-medium text-white inline-flex items-center gap-2 whitespace-nowrap"
            >
              <Download className="w-4 h-4 text-[#9B82FF]" />
              <span>Report (.md)</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('reconstruction-editor')}
              className="px-3.5 py-2 rounded-lg bg-[#1A1D26] hover:bg-[#232736] border border-white/[0.1] text-[13px] font-medium text-white whitespace-nowrap"
            >
              Open Editor
            </button>
            <button
              type="button"
              onClick={() => onNavigate('premiere-export')}
              className="px-4 py-2 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4BF0] text-[13px] font-medium text-white inline-flex items-center gap-2 whitespace-nowrap"
            >
              <FolderArchive className="w-4 h-4" />
              <span>Download Premiere Project</span>
            </button>
          </div>
        )}
      </div>

      {/* 11-Stage Pipeline Board */}
      <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-white">Processing Pipeline Stages</h2>
          <span className="text-[12px] font-mono tabular-nums text-[#8E96AC]">
            {doneOrWarnCount} / {pipelineStages.length} processed
            {warningStages.length > 0 ? ` · ${warningStages.length} partial/skipped` : ''}
          </span>
        </div>

        {analysisError && (
          <div className="p-3.5 rounded-lg bg-[#1F1215] border border-[#DC2626]/45 text-[13px] text-[#FCA5A5]">
            {analysisError}
          </div>
        )}

        {!isAnalyzing && project && warningStages.length > 0 && (
          <div className="p-4 rounded-lg bg-[#1B170F] border border-[#D97706]/45 flex flex-wrap items-center justify-between gap-4 text-[13px]">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-[#FBBF24] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-medium text-white">
                  Completed with {warningStages.length} partial/skipped stage
                  {warningStages.length > 1 ? 's' : ''} — Premiere Project is ready to download
                </div>
                <p className="text-[12px] text-[#D4D8E3]">
                  All available cuts, timeline tracks, audio markers, and XMEML sequence data were
                  assembled cleanly without failing the export.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('premiere-export')}
              className="px-3.5 py-2 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4BF0] text-white text-[12px] font-medium whitespace-nowrap shrink-0"
            >
              Go to Download (.xml / .zip)
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {pipelineStages.map((st) => (
            <div
              key={st.id}
              className={`p-3.5 rounded-lg border flex items-start gap-3 ${
                st.status === 'done'
                  ? 'bg-[#0E1612] border-[#16A34A]/30'
                  : st.status === 'warning'
                  ? 'bg-[#1B170F] border-[#D97706]/45'
                  : st.status === 'active'
                  ? 'bg-[#161326] border-[#7C5CFF]/55'
                  : st.status === 'error'
                  ? 'bg-[#1D1114] border-[#DC2626]/45'
                  : 'bg-[#0C0D11] border-white/[0.06]'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {st.status === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                ) : st.status === 'warning' ? (
                  <AlertTriangle className="w-4 h-4 text-[#FBBF24]" />
                ) : st.status === 'error' ? (
                  <XCircle className="w-4 h-4 text-[#DC2626]" />
                ) : st.status === 'active' ? (
                  <Clock className="w-4 h-4 text-[#9B82FF] animate-spin" />
                ) : (
                  <span className="w-4 h-4 rounded-full border border-white/[0.15] inline-block" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-white flex items-center justify-between gap-2">
                  <span className="truncate">
                    {String(st.id).padStart(2, '0')}. {st.label}
                  </span>
                  {st.status === 'warning' && (
                    <span className="text-[10px] font-mono text-[#FBBF24] shrink-0">Partial</span>
                  )}
                </div>
                <div className="text-[12px] text-[#8E96AC] truncate mt-0.5 font-mono" title={st.detail}>
                  {st.detail || (st.status === 'pending' ? 'Waiting' : isAnalyzing ? 'Running…' : 'Idle')}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {!project ? (
        <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-10 text-center space-y-2">
          <div className="text-[15px] font-medium text-white">No completed analysis loaded</div>
          <p className="text-[13px] text-[#8E96AC]">
            Start an analysis from the Dashboard or Upload Video view to inspect the full technical
            breakdown here.
          </p>
        </div>
      ) : (
        <>
          {/* Technical Metadata & Editorial Structure */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-semibold text-white">Editorial Structure & Pacing</h2>
                <span className="text-[12px] text-[#9B82FF] font-medium">
                  {project.summary.styleLabel}
                </span>
              </div>
              <p className="text-[14px] text-[#C6CBD9] leading-relaxed">
                {project.summary.technicalOverview}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-white/[0.08]">
                <div>
                  <div className="text-[11px] text-[#7F869B]">Total Shots</div>
                  <div className="text-[20px] font-mono tabular-nums font-semibold text-white mt-0.5">
                    {project.shots.length}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7F869B]">Avg Shot Length</div>
                  <div className="text-[20px] font-mono tabular-nums font-semibold text-white mt-0.5">
                    {project.summary.averageShotDurationSec.toFixed(2)}s
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7F869B]">Cut Frequency</div>
                  <div className="text-[20px] font-mono tabular-nums font-semibold text-white mt-0.5">
                    {project.summary.cutsPerMinute}/m
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7F869B]">Beat Tempo</div>
                  <div className="text-[20px] font-mono tabular-nums font-semibold text-[#38BDF8] mt-0.5">
                    {project.audio.hasAudio ? `${project.audio.estimatedBpm} BPM` : 'Silent'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-white/[0.08] text-[13px]">
                <div>
                  <div className="text-[11px] font-medium text-[#9B82FF]">Opening Sequence</div>
                  <p className="text-[#A5ACBF] mt-1 leading-relaxed">
                    {project.summary.openingSequenceNote}
                  </p>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-[#3B82F6]">Main Sequence</div>
                  <p className="text-[#A5ACBF] mt-1 leading-relaxed">
                    {project.summary.mainSequenceNote}
                  </p>
                </div>
                <div>
                  <div className="text-[11px] font-medium text-[#A5ACBF]">Closing Sequence</div>
                  <p className="text-[#A5ACBF] mt-1 leading-relaxed">
                    {project.summary.closingSequenceNote}
                  </p>
                </div>
              </div>
            </div>

            {/* Source Media Technical Probe */}
            <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-3 text-[13px]">
              <h2 className="text-[16px] font-semibold text-white">Source Media Probe</h2>
              <div className="divide-y divide-white/[0.06] font-mono tabular-nums">
                {[
                  ['Resolution', `${project.metadata.width} × ${project.metadata.height}`],
                  ['Aspect Ratio', project.metadata.aspectRatio],
                  ['Timebase', `${project.metadata.fps} fps`],
                  ['Duration', formatTimecodeMs(project.metadata.durationSec)],
                  ['Container', project.metadata.container],
                  ['Codec', project.metadata.codec],
                  ['Est. Bitrate', `${project.metadata.bitrateKbps.toLocaleString()} kbps`],
                  ['File Size', formatFileSize(project.metadata.fileSizeBytes)],
                  ['Audio', `${(project.metadata.audioSampleRate / 1000).toFixed(1)} kHz · ${project.metadata.audioChannels}ch`],
                  ['Color Space', project.metadata.colorSpace],
                ].map(([k, v]) => (
                  <div key={k} className="py-2 flex items-center justify-between gap-2">
                    <span className="font-sans text-[#7F869B] text-[12px]">{k}</span>
                    <span className="text-[#E2E6F0] text-[12px] truncate text-right">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Chronological AI Confidence & Shot Report */}
          <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4">
            <h2 className="text-[16px] font-semibold text-white">
              Chronological Shot-by-Shot Reconstruction Report
            </h2>
            <div className="divide-y divide-white/[0.08]">
              {project.shots.map((s) => (
                <div key={s.id} className="py-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                  <div className="md:col-span-3 flex items-center gap-3">
                    {s.thumbnailDataUrl && (
                      <img
                        src={s.thumbnailDataUrl}
                        alt={s.name}
                        referrerPolicy="no-referrer"
                        className="w-12 h-16 object-cover rounded border border-white/[0.1] shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-white truncate">
                        SHOT {String(s.index + 1).padStart(2, '0')} · {s.name}
                      </div>
                      <div className="text-[12px] font-mono tabular-nums text-[#9B82FF] mt-0.5">
                        {formatTimecodeMs(s.startTimeSec)} – {formatTimecodeMs(s.endTimeSec)}
                      </div>
                      <div className="text-[12px] text-[#7F869B] mt-0.5">
                        {s.shotType} · {s.section}
                      </div>
                    </div>
                  </div>

                  <div className="md:col-span-6 text-[13px] space-y-1.5">
                    <p className="text-[#D4D8E3]">{s.description}</p>
                    <div className="text-[12px] text-[#8E96AC] flex flex-wrap gap-x-3 gap-y-1">
                      <span>Motion: {s.cameraMovement}</span>
                      <span>·</span>
                      <span>Scale: {s.scale}%</span>
                      <span>·</span>
                      <span>Speed: {s.speedPercent}%</span>
                      <span>·</span>
                      <span>Transition: {s.transitionOut.type} ({s.transitionOut.durationSec}s)</span>
                      <span>·</span>
                      <span>Color: {s.colorShiftNote}</span>
                    </div>
                  </div>

                  <div className="md:col-span-3 md:text-right text-[12px] space-y-1">
                    <div
                      className={`font-medium ${
                        s.confidence === 'High'
                          ? 'text-[#4ADE80]'
                          : s.confidence === 'Medium'
                          ? 'text-[#FBBF24]'
                          : 'text-[#F87171]'
                      }`}
                    >
                      Confidence: {s.confidence}
                    </div>
                    <div className="text-[#8E96AC]">
                      Premiere: {s.transitionOut.premiereSupport}
                    </div>
                    <div className="font-mono tabular-nums text-[#6E768C]">
                      {s.beatAligned
                        ? `Beat synced (${formatShortSec(s.alignedBeatTimeSec || s.startTimeSec)})`
                        : `CV cut delta: ${s.measuredCutDelta}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

/* ===================== 2. SHOT BREAKDOWN VIEW ===================== */

interface ShotBreakdownViewProps {
  project: ReelProject;
  onSelectShotAndEdit: (shotId: string, timeSec: number) => void;
}

export const ShotBreakdownView: React.FC<ShotBreakdownViewProps> = ({
  project,
  onSelectShotAndEdit,
}) => {
  const [sectionFilter, setSectionFilter] = useState<'All' | 'Opening' | 'Main' | 'Closing'>('All');

  const filteredShots = useMemo(
    () =>
      sectionFilter === 'All'
        ? project.shots
        : project.shots.filter((s) => s.section === sectionFilter),
    [project.shots, sectionFilter]
  );

  return (
    <div className="max-w-[1160px] mx-auto px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-[26px] font-semibold text-white">Shot Breakdown</h1>
          <p className="text-[14px] text-[#A5ACBF]">
            {project.shots.length} detected shots across {formatShortSec(project.metadata.durationSec)}{' '}
            with camera motion, speed ramps, and beat-sync timing.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#13151B] rounded-lg border border-white/[0.08]">
          {(['All', 'Opening', 'Main', 'Closing'] as const).map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => setSectionFilter(sec)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                sectionFilter === sec
                  ? 'bg-[#7C5CFF] text-white'
                  : 'text-[#8E96AC] hover:text-white'
              }`}
            >
              {sec}
            </button>
          ))}
        </div>
      </div>

      {/* Shot Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredShots.map((shot) => (
          <div
            key={shot.id}
            className="rounded-xl bg-[#13151B] border border-white/[0.08] overflow-hidden flex flex-col"
          >
            <div className="relative h-48 bg-[#08090C] overflow-hidden flex items-center justify-center">
              {shot.thumbnailDataUrl ? (
                <img
                  src={shot.thumbnailDataUrl}
                  alt={shot.name}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain"
                />
              ) : (
                <Film className="w-8 h-8 text-[#4B5164]" />
              )}
              <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/85 to-transparent" />
              <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-[12px] font-mono tabular-nums text-white">
                <span>SHOT {String(shot.index + 1).padStart(2, '0')}</span>
                <span>
                  {formatSmpte(shot.startTimeSec, project.metadata.fps)} →{' '}
                  {formatSmpte(shot.endTimeSec, project.metadata.fps)}
                </span>
              </div>
            </div>

            <div className="p-4 flex-1 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-white leading-snug">
                    {shot.name}
                  </h3>
                  <span className="text-[12px] font-mono tabular-nums text-[#9B82FF] shrink-0">
                    {shot.durationSec.toFixed(2)}s
                  </span>
                </div>
                <div className="text-[12px] text-[#8E96AC]">
                  {shot.shotType} · {shot.cameraMovement} · {shot.speedPercent}% speed
                </div>
                <p className="text-[13px] text-[#A5ACBF] leading-relaxed">{shot.description}</p>
              </div>

              <div className="pt-3 border-t border-white/[0.08] flex items-center justify-between text-[12px]">
                <span className="text-[#7F869B]">
                  Out: {shot.transitionOut.type} · {shot.confidence}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectShotAndEdit(shot.id, shot.startTimeSec)}
                  className="text-[#9B82FF] hover:text-white font-medium inline-flex items-center gap-1 transition-colors"
                >
                  <span>Edit Clip</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ===================== 3. AUDIO & SOUND DESIGN ANALYSIS VIEW ===================== */

interface AudioAnalysisViewProps {
  project: ReelProject;
  currentTimeSec: number;
  onSeek: (timeSec: number) => void;
  onUpdateTracks: (tracks: AudioTrackMix[]) => void;
  onUpdateAudioEffect: (effectId: string, patch: Partial<AudioEffectItem>) => void;
}

export const AudioAnalysisView: React.FC<AudioAnalysisViewProps> = ({
  project,
  currentTimeSec,
  onSeek,
  onUpdateTracks,
  onUpdateAudioEffect,
}) => {
  const { audio } = project;
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replacingTrackId, setReplacingTrackId] = useState<'A2' | 'A3' | 'A4' | null>(null);

  const audioEffects = audio.audioEffects ?? [];
  const freeAudioEffects = audioEffects.filter((ef) => ef.licenseTier === 'Free / Built-in');
  const paidAudioEffects = audioEffects.filter((ef) => ef.licenseTier === 'Paid / Third-Party');
  const sp = audio.spectralProfile;

  const updateTrack = (id: AudioTrackMix['id'], patch: Partial<AudioTrackMix>) => {
    onUpdateTracks(audio.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  return (
    <div className="max-w-[1160px] mx-auto px-8 py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-[26px] font-semibold text-white">
          Audio & Sound Design Analysis
        </h1>
        <p className="text-[14px] text-[#A5ACBF]">
          Web Audio DSP waveform, beat/downbeat grid, musical energy sections, and transition SFX
          alignment.
        </p>
      </div>

      {/* Key Audio Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-4">
          <div className="text-[12px] text-[#7F869B]">Estimated Tempo</div>
          <div className="text-[24px] font-mono tabular-nums font-semibold text-white mt-1">
            {audio.hasAudio ? `${audio.estimatedBpm} BPM` : 'No Audio'}
          </div>
          <div className="text-[12px] text-[#8E96AC] mt-0.5">
            Confidence: {audio.bpmConfidence}
          </div>
        </div>
        <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-4">
          <div className="text-[12px] text-[#7F869B]">Detected Beats</div>
          <div className="text-[24px] font-mono tabular-nums font-semibold text-[#38BDF8] mt-1">
            {audio.beats.length}
          </div>
          <div className="text-[12px] text-[#8E96AC] mt-0.5">
            {audio.beats.filter((b) => b.isDownbeat).length} musical downbeats
          </div>
        </div>
        <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-4">
          <div className="text-[12px] text-[#7F869B]">Beat-Synced Cuts</div>
          <div className="text-[24px] font-mono tabular-nums font-semibold text-[#9B82FF] mt-1">
            {project.shots.filter((s, i) => i > 0 && s.beatAligned).length} /{' '}
            {Math.max(0, project.shots.length - 1)}
          </div>
          <div className="text-[12px] text-[#8E96AC] mt-0.5">Cuts aligned to rhythm grid</div>
        </div>
        <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-4">
          <div className="text-[12px] text-[#7F869B]">Audio Format</div>
          <div className="text-[24px] font-mono tabular-nums font-semibold text-white mt-1">
            {(audio.sampleRate / 1000).toFixed(1)} kHz
          </div>
          <div className="text-[12px] text-[#8E96AC] mt-0.5">
            {audio.channels} channels · {audio.sfxEvents.length} SFX cues
          </div>
        </div>
      </div>

      {/* Interactive Waveform + Beat Markers */}
      <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-white">
              Audio Waveform & Beat Grid
            </h2>
            <p className="text-[12px] text-[#8E96AC]">{audio.musicDescription}</p>
          </div>
          <span className="text-[12px] font-mono tabular-nums text-[#38BDF8]">
            Playhead: {formatTimecodeMs(currentTimeSec)}
          </span>
        </div>

        {/* Clickable Waveform Canvas */}
        <div
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            onSeek(ratio * project.metadata.durationSec);
          }}
          className="relative h-36 rounded-lg bg-[#08090C] border border-white/[0.08] px-2 py-4 flex items-center gap-[2px] cursor-pointer overflow-hidden"
        >
          {audio.waveformPeaks.map((peak, i) => (
            <div
              key={i}
              className="flex-1 bg-[#38BDF8]/80 rounded-[1px]"
              style={{ height: `${Math.max(5, Math.round(peak * 94))}%` }}
            />
          ))}

          {/* Beat Markers */}
          {audio.beats.map((b) => (
            <div
              key={b.id}
              title={`Bar ${b.barNumber}.${b.beatInBar} (${b.timeSec.toFixed(2)}s)`}
              className={`pointer-events-none absolute top-0 bottom-0 border-l ${
                b.isDownbeat ? 'border-[#7C5CFF]/80' : 'border-white/[0.12]'
              }`}
              style={{ left: `${(b.timeSec / Math.max(0.1, project.metadata.durationSec)) * 100}%` }}
            />
          ))}

          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-white"
            style={{
              left: `${(currentTimeSec / Math.max(0.1, project.metadata.durationSec)) * 100}%`,
            }}
          />
        </div>

        {/* Musical Structure Sections */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {audio.sections.map((sec, idx) => (
            <button
              key={`${sec.name}-${idx}`}
              type="button"
              onClick={() => onSeek(sec.startTimeSec)}
              className="p-3 rounded-lg bg-[#0C0D11] border border-white/[0.08] hover:border-[#3B82F6]/50 text-left transition-colors"
            >
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium text-white">{sec.name}</span>
                <span className="font-mono tabular-nums text-[#38BDF8]">{sec.energyLevel}%</span>
              </div>
              <div className="text-[11px] font-mono tabular-nums text-[#7F869B] mt-1">
                {sec.startTimeSec.toFixed(2)}s – {sec.endTimeSec.toFixed(2)}s
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Deep Spectral & Dynamics Telemetry */}
      {sp && (
        <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-white">
                Spectral Balance & Dynamics Telemetry
              </h2>
              <p className="text-[12px] text-[#8E96AC]">
                Measured directly from decoded PCM samples to automatically configure Premiere Pro EQ,
                compression, limiting, reverb, and stereo filters.
              </p>
            </div>
            <span className="text-[12px] font-mono tabular-nums text-[#9B82FF]">
              Reverb Tail: {sp.reverbTailEstimate}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 space-y-3">
              {[
                { label: 'Sub-Bass (<80 Hz)', value: sp.subBassEnergy, color: 'bg-[#7C5CFF]' },
                { label: 'Bass (80–250 Hz)', value: sp.bassEnergy, color: 'bg-[#3B82F6]' },
                { label: 'Midrange (250 Hz–4 kHz)', value: sp.midEnergy, color: 'bg-[#38BDF8]' },
                { label: 'Highs / Air (4 kHz+)', value: sp.highEnergy, color: 'bg-[#4ADE80]' },
              ].map((band) => (
                <div key={band.label} className="space-y-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[#C6CBD9]">{band.label}</span>
                    <span className="font-mono tabular-nums text-white">{band.value}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#0C0D11] overflow-hidden">
                    <div
                      className={`h-full ${band.color} rounded-full`}
                      style={{ width: `${Math.min(100, Math.max(2, band.value))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="lg:col-span-6 grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px]">
              <div className="p-3 rounded-lg bg-[#0C0D11] border border-white/[0.06]">
                <div className="text-[#7F869B]">Integrated RMS</div>
                <div className="text-[16px] font-mono tabular-nums font-semibold text-white mt-0.5">
                  {sp.integratedRmsDb} dBFS
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#0C0D11] border border-white/[0.06]">
                <div className="text-[#7F869B]">True Peak</div>
                <div className="text-[16px] font-mono tabular-nums font-semibold text-white mt-0.5">
                  {sp.peakDb} dBFS
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#0C0D11] border border-white/[0.06]">
                <div className="text-[#7F869B]">Dynamic Range</div>
                <div className="text-[16px] font-mono tabular-nums font-semibold text-[#38BDF8] mt-0.5">
                  {sp.dynamicRangeDb} dB
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#0C0D11] border border-white/[0.06]">
                <div className="text-[#7F869B]">Stereo Width</div>
                <div className="text-[16px] font-mono tabular-nums font-semibold text-white mt-0.5">
                  {sp.stereoWidthPercent}%
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#0C0D11] border border-white/[0.06]">
                <div className="text-[#7F869B]">Low-Pass Filter</div>
                <div className="text-[14px] font-medium text-white mt-1">
                  {sp.lowPassFilterDetected ? 'Detected' : 'Full Spectrum'}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-[#0C0D11] border border-white/[0.06]">
                <div className="text-[#7F869B]">Ducking / Comp</div>
                <div className="text-[14px] font-medium text-white mt-1">
                  {sp.sidechainOrDuckingDetected ? 'Active Pumping' : 'Natural'}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Detected Audio Effects (Free Built-in Included vs Paid Plugins Skipped) */}
      <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-white">
              Reconstructed Audio Effects (Premiere Pro Track Filters)
            </h2>
            <p className="text-[12px] text-[#8E96AC]">
              All Free / Built-in Premiere Pro audio effects are automatically added to Track A1 in
              XMEML. Paid third-party audio plugins are safely skipped without interrupting export.
            </p>
          </div>
          <span className="text-[12px] font-mono tabular-nums text-[#4ADE80]">
            {freeAudioEffects.filter((e) => e.includedInTimeline).length} Free FX Active
            {paidAudioEffects.length > 0 ? ` · ${paidAudioEffects.length} Paid Skipped` : ''}
          </span>
        </div>

        {freeAudioEffects.length === 0 ? (
          <div className="p-4 rounded-lg bg-[#0C0D11] border border-white/[0.06] text-[13px] text-[#7F869B]">
            No additional audio filters required beyond standard track volume & fades.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {freeAudioEffects.map((afx) => (
              <div
                key={afx.id}
                className={`p-4 rounded-lg border space-y-3 transition-colors ${
                  afx.includedInTimeline
                    ? 'bg-[#0C0D11] border-white/[0.08]'
                    : 'bg-[#0C0D11]/50 border-white/[0.04] opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-white truncate">{afx.name}</div>
                    <div className="text-[11px] font-mono tabular-nums text-[#8E96AC] mt-0.5">
                      {afx.premiereEffectName} · Track {afx.trackId} · {afx.category} ·{' '}
                      {afx.detectionSource || 'Web Audio DSP'}
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-[#4ADE80] shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={afx.includedInTimeline}
                      onChange={(e) =>
                        onUpdateAudioEffect(afx.id, { includedInTimeline: e.target.checked })
                      }
                      className="w-3.5 h-3.5 accent-[#7C5CFF]"
                    />
                    <span>{afx.includedInTimeline ? 'Added' : 'Muted'}</span>
                  </label>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-[#8E96AC]">Filter Intensity</span>
                    <span className="font-mono tabular-nums text-white">{afx.intensity}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={afx.intensity}
                    onChange={(e) =>
                      onUpdateAudioEffect(afx.id, { intensity: Number(e.target.value) })
                    }
                    className="w-full"
                  />
                </div>

                <div className="text-[12px] text-[#A5ACBF] leading-relaxed">{afx.notes}</div>
              </div>
            ))}
          </div>
        )}

        {paidAudioEffects.length > 0 && (
          <div className="pt-4 border-t border-white/[0.08] space-y-3">
            <div className="flex items-center gap-2 text-[13px] font-medium text-[#FBBF24]">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Skipped Paid / Third-Party Audio Plugins ({paidAudioEffects.length})</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {paidAudioEffects.map((afx) => (
                <div
                  key={afx.id}
                  className="p-3.5 rounded-lg bg-[#19150E] border border-[#D97706]/35 space-y-1 text-[12px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-white">{afx.name}</span>
                    <span className="font-mono text-[#FBBF24] shrink-0">Paid · Skipped</span>
                  </div>
                  <div className="text-[#8E96AC] font-mono">
                    Vendor: {afx.pluginVendor || 'Third-Party'} · Track {afx.trackId}
                  </div>
                  <p className="text-[#D4D8E3] leading-relaxed">
                    {afx.skippedReason || afx.notes}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Multitrack Audio Mixer & Replacement Controls */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-white">Reconstructed Audio Tracks</h2>
            <Music className="w-4 h-4 text-[#38BDF8]" />
          </div>
          <p className="text-[12px] text-[#8E96AC] leading-relaxed">{audio.sourceSeparationNote}</p>

          <div className="space-y-3">
            {audio.tracks.map((tr) => (
              <div
                key={tr.id}
                className="p-3.5 rounded-lg bg-[#0C0D11] border border-white/[0.08] space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-white">
                      <span className="font-mono text-[#38BDF8] mr-2">{tr.id}</span>
                      {tr.name}
                    </div>
                    <div className="text-[11px] text-[#7F869B] mt-0.5">
                      {tr.replacementFileName
                        ? `Licensed replacement attached: ${tr.replacementFileName}`
                        : tr.licensingNote}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {tr.id !== 'A1' && (
                      <button
                        type="button"
                        onClick={() => {
                          setReplacingTrackId(tr.id as 'A2' | 'A3' | 'A4');
                          replaceInputRef.current?.click();
                        }}
                        className="px-2.5 py-1 rounded bg-[#1A1D26] hover:bg-[#232736] text-[11px] text-[#D4D8E3] whitespace-nowrap"
                      >
                        Replace Audio
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => updateTrack(tr.id, { muted: !tr.muted })}
                      className={`p-1.5 rounded ${
                        tr.muted ? 'bg-[#DC2626]/20 text-[#F87171]' : 'bg-[#1A1D26] text-[#A5ACBF]'
                      }`}
                    >
                      {tr.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 items-center text-[11px]">
                  <div className="col-span-2 flex items-center gap-2">
                    <Sliders className="w-3 h-3 text-[#6E768C]" />
                    <input
                      type="range"
                      min={-36}
                      max={6}
                      step={1}
                      value={tr.volumeDb}
                      onChange={(e) => updateTrack(tr.id, { volumeDb: Number(e.target.value) })}
                      className="flex-1"
                    />
                    <span className="font-mono tabular-nums text-[#D4D8E3] w-11 text-right">
                      {tr.volumeDb > 0 ? `+${tr.volumeDb}` : tr.volumeDb} dB
                    </span>
                  </div>
                  <div className="font-mono tabular-nums text-right text-[#7F869B]">
                    Fade {tr.fadeInSec}s / {tr.fadeOutSec}s
                  </div>
                </div>
              </div>
            ))}
          </div>

          <input
            ref={replaceInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.aac,.m4a,.ogg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && replacingTrackId) {
                updateTrack(replacingTrackId, { replacementFileName: f.name });
              }
              e.target.value = '';
            }}
          />
        </div>

        {/* Detected Sound Effects & Visual Sync Table */}
        <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-white">
              Sound Effects & Visual Sync Events
            </h2>
            <FileAudio className="w-4 h-4 text-[#4ADE80]" />
          </div>

          {audio.sfxEvents.length === 0 ? (
            <div className="p-6 rounded-lg bg-[#0C0D11] border border-white/[0.06] text-[13px] text-[#7F869B]">
              No discrete sound effects (whooshes, impacts, risers) were isolated above the music
              floor. You can still place SFX stems on Track A3 aligned to the beat markers in Premiere.
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {audio.sfxEvents.map((sfx) => (
                <div
                  key={sfx.id}
                  className="py-3 flex items-start justify-between gap-3 text-[13px]"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-medium text-white">
                      {sfx.label}{' '}
                      <span className="text-[12px] font-normal text-[#7F869B]">
                        · {sfx.category}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#A5ACBF]">{sfx.linkedVisualEvent}</div>
                    <div className="text-[11px] font-mono tabular-nums text-[#7F869B]">
                      {formatTimecodeMs(sfx.timeSec)} · {sfx.durationSec.toFixed(2)}s · Confidence:{' '}
                      {sfx.confidence}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSeek(sfx.timeSec)}
                    className="p-2 rounded-lg bg-[#1A1D26] hover:bg-[#7C5CFF] text-white shrink-0 transition-colors"
                    title="Jump playhead to SFX"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-white/[0.08] text-[12px] text-[#8E96AC]">
            <span className="font-medium text-white">Voiceover / Dialogue:</span>{' '}
            {audio.voiceoverDetected ? audio.voiceoverNotes : 'No prominent voiceover detected.'}
          </div>
        </div>
      </section>
    </div>
  );
};
