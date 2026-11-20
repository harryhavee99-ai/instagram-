import React, { useCallback, useEffect, useState } from 'react';
import { Film } from 'lucide-react';
import type {
  AnalysisPipelineStage,
  AppSettings,
  AudioEffectItem,
  AudioTrackMix,
  ColorGradeSettings,
  EffectItem,
  InstagramInspectResult,
  MotionGraphicItem,
  NavPage,
  ReelProject,
  ShotClip,
} from './types/project';
import { computeComparisonMetrics } from './engine/comparisonEngine';
import { clamp } from './engine/formatters';
import { generateLocalSampleReel } from './engine/sampleReelGenerator';
import {
  INITIAL_PIPELINE_STAGES,
  runFullVideoAnalysis,
  runLinkBasedReconstruction,
} from './engine/videoAnalyzer';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { DashboardView } from './components/DashboardView';
import { ImportInstagramView, UploadVideoView } from './components/ImportUploadViews';
import {
  AudioAnalysisView,
  ShotBreakdownView,
  VideoAnalysisView,
} from './components/AnalysisViews';
import { ColorAnalysisView, EffectsAnalysisView } from './components/ColorEffectsViews';
import {
  ReconstructionEditorView,
  TimelineEditorView,
} from './components/ReconstructionEditorView';
import { ComparisonView } from './components/ComparisonView';
import { PremiereExportView } from './components/PremiereExportView';
import { ProjectHistoryView, SettingsView } from './components/HistorySettingsViews';

const DEFAULT_SETTINGS: AppSettings = {
  defaultTimebase: 30,
  samplingDensity: 'Balanced',
  proxyQuality: '720p Proxy',
  beatSnapToleranceMs: 90,
  includeSourceMediaInZip: true,
  autoGenerateCubeLut: true,
  rightsAcknowledged: true,
};

export default function App() {
  const [activePage, setActivePage] = useState<NavPage>('dashboard');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [serverStatus, setServerStatus] = useState<{
    geminiConfigured: boolean;
    metaOembedConfigured: boolean;
  } | null>(null);

  // Instagram inspection state
  const [instagramUrl, setInstagramUrl] = useState('');
  const [instagramResult, setInstagramResult] = useState<InstagramInspectResult | null>(null);
  const [inspectingUrl, setInspectingUrl] = useState(false);

  // Analysis pipeline state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<AnalysisPipelineStage[]>(
    INITIAL_PIPELINE_STAGES
  );
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [generatingSample, setGeneratingSample] = useState(false);
  const [sampleProgress, setSampleProgress] = useState(0);

  // Active project + undo/redo stack + media handle
  const [projects, setProjects] = useState<ReelProject[]>([]);
  const [activeProject, setActiveProject] = useState<ReelProject | null>(null);
  const [undoStack, setUndoStack] = useState<ReelProject[]>([]);
  const [redoStack, setRedoStack] = useState<ReelProject[]>([]);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [videoObjectUrl, setVideoObjectUrl] = useState<string | null>(null);

  // Playback & selection state
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [selectedGraphicId, setSelectedGraphicId] = useState<string | null>(null);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);

  // Load persisted projects and server capability status on mount
  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) {
          setServerStatus({
            geminiConfigured: Boolean(data.geminiConfigured),
            metaOembedConfigured: Boolean(data.metaOembedConfigured),
          });
        }
      })
      .catch(() => {});

    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.projects)) {
          setProjects(data.projects);
        }
      })
      .catch(() => {});
  }, []);

  const persistProject = useCallback((project: ReelProject) => {
    setProjects((prev) => [project, ...prev.filter((p) => p.id !== project.id)].slice(0, 30));
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project }),
    }).catch(() => {});
  }, []);

  const commitProjectEdit = useCallback(
    (updater: (prev: ReelProject) => ReelProject) => {
      setActiveProject((prev) => {
        if (!prev) return prev;
        setUndoStack((u) => [...u.slice(-24), prev]);
        setRedoStack([]);
        const updatedBase = updater(prev);
        const withMetrics: ReelProject = {
          ...updatedBase,
          updatedAt: new Date().toISOString(),
          comparison: computeComparisonMetrics(updatedBase),
        };
        persistProject(withMetrics);
        return withMetrics;
      });
    },
    [persistProject]
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0 || !activeProject) return prevUndo;
      const previous = prevUndo[prevUndo.length - 1];
      setRedoStack((r) => [...r, activeProject]);
      setActiveProject(previous);
      return prevUndo.slice(0, -1);
    });
  }, [activeProject]);

  const handleRedo = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0 || !activeProject) return prevRedo;
      const next = prevRedo[prevRedo.length - 1];
      setUndoStack((u) => [...u, activeProject]);
      setActiveProject(next);
      return prevRedo.slice(0, -1);
    });
  }, [activeProject]);

  const handleAnalyzeInstagramLink = useCallback(
    async (infoOverride?: InstagramInspectResult) => {
      const targetInfo = infoOverride ?? instagramResult;
      if (!targetInfo || !targetInfo.valid) return;

      setIsPlaying(false);
      setIsAnalyzing(true);
      setAnalysisError(null);
      setPipelineStages(INITIAL_PIPELINE_STAGES.map((s) => ({ ...s })));
      setActivePage('video-analysis');

      try {
        const result = await runLinkBasedReconstruction({
          instagramInfo: targetInfo,
          settings,
          onStageUpdate: setPipelineStages,
        });

        if (videoObjectUrl) {
          URL.revokeObjectURL(videoObjectUrl);
        }
        setSourceFile(null);
        setVideoObjectUrl(result.videoObjectUrl);
        setActiveProject(result.project);
        setUndoStack([]);
        setRedoStack([]);
        setCurrentTimeSec(0);
        setSelectedShotId(result.project.shots[0]?.id ?? null);
        setSelectedGraphicId(result.project.motionGraphics[0]?.id ?? null);
        setSelectedEffectId(result.project.effects[0]?.id ?? null);
        persistProject(result.project);
      } catch (err) {
        setAnalysisError(
          err instanceof Error ? err.message : 'Link reconstruction failed unexpectedly.'
        );
      } finally {
        setIsAnalyzing(false);
      }
    },
    [instagramResult, settings, videoObjectUrl, persistProject]
  );

  const handleInspectInstagramUrl = useCallback(
    async (url: string, autoBuild = false) => {
      setInspectingUrl(true);
      setAnalysisError(null);
      try {
        const res = await fetch('/api/instagram/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = (await res.json()) as InstagramInspectResult;
        setInstagramResult(data);
        if (data.valid && (autoBuild || data.directVideoAvailable)) {
          setInspectingUrl(false);
          await handleAnalyzeInstagramLink(data);
          return;
        }
      } catch {
        setInstagramResult({
          valid: false,
          url,
          oEmbedAvailable: false,
          oEmbedConfigured: false,
          directVideoAvailable: false,
          accessNotice: 'Failed to contact server Instagram URL inspector.',
          error: 'Network error',
        });
      } finally {
        setInspectingUrl(false);
      }
    },
    [handleAnalyzeInstagramLink]
  );

  const handleAnalyzeFile = useCallback(
    async (file: File, origin: 'instagram-upload' | 'direct-upload' | 'sample-reel') => {
      setIsPlaying(false);
      setIsAnalyzing(true);
      setAnalysisError(null);
      setPipelineStages(INITIAL_PIPELINE_STAGES.map((s) => ({ ...s })));
      setActivePage('video-analysis');

      try {
        const result = await runFullVideoAnalysis({
          file,
          sourceOrigin: origin,
          instagramInfo: origin === 'instagram-upload' && instagramResult?.valid ? instagramResult : undefined,
          settings,
          onStageUpdate: setPipelineStages,
        });

        if (videoObjectUrl) {
          URL.revokeObjectURL(videoObjectUrl);
        }
        setSourceFile(file);
        setVideoObjectUrl(result.videoObjectUrl);
        setActiveProject(result.project);
        setUndoStack([]);
        setRedoStack([]);
        setCurrentTimeSec(0);
        setSelectedShotId(result.project.shots[0]?.id ?? null);
        setSelectedGraphicId(result.project.motionGraphics[0]?.id ?? null);
        setSelectedEffectId(result.project.effects[0]?.id ?? null);
        persistProject(result.project);
      } catch (err) {
        setAnalysisError(
          err instanceof Error ? err.message : 'Video analysis failed unexpectedly.'
        );
      } finally {
        setIsAnalyzing(false);
      }
    },
    [instagramResult, settings, videoObjectUrl, persistProject]
  );

  const handleGenerateSampleReel = useCallback(async () => {
    setGeneratingSample(true);
    setSampleProgress(0);
    setAnalysisError(null);
    try {
      const sampleFile = await generateLocalSampleReel((pct) => setSampleProgress(pct));
      setGeneratingSample(false);
      await handleAnalyzeFile(sampleFile, 'sample-reel');
    } catch (err) {
      setGeneratingSample(false);
      setAnalysisError(
        err instanceof Error
          ? `Could not synthesize sample Reel in this browser: ${err.message}`
          : 'Sample generation failed.'
      );
    }
  }, [handleAnalyzeFile]);

  const handleOpenProject = useCallback((project: ReelProject) => {
    setIsPlaying(false);
    setActiveProject(project);
    setUndoStack([]);
    setRedoStack([]);
    setCurrentTimeSec(0);
    setSelectedShotId(project.shots[0]?.id ?? null);
    setSelectedGraphicId(project.motionGraphics[0]?.id ?? null);
    setSelectedEffectId(project.effects[0]?.id ?? null);
    setActivePage('reconstruction-editor');
  }, []);

  const handleDeleteProject = useCallback(
    (id: string) => {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (activeProject?.id === id) {
        setActiveProject(null);
      }
      fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    },
    [activeProject]
  );

  // Editor mutation handlers
  const handleUpdateShot = useCallback(
    (shotId: string, patch: Partial<ShotClip>) => {
      commitProjectEdit((prev) => ({
        ...prev,
        shots: prev.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)),
      }));
    },
    [commitProjectEdit]
  );

  const handleUpdateColorGrade = useCallback(
    (next: ColorGradeSettings) => {
      commitProjectEdit((prev) => ({
        ...prev,
        colorGrade: next,
      }));
    },
    [commitProjectEdit]
  );

  const handleUpdateEffect = useCallback(
    (fxId: string, patch: Partial<EffectItem>) => {
      commitProjectEdit((prev) => ({
        ...prev,
        effects: prev.effects.map((e) => (e.id === fxId ? { ...e, ...patch } : e)),
      }));
    },
    [commitProjectEdit]
  );

  const handleUpdateGraphic = useCallback(
    (gfxId: string, patch: Partial<MotionGraphicItem>) => {
      commitProjectEdit((prev) => ({
        ...prev,
        motionGraphics: prev.motionGraphics.map((g) => (g.id === gfxId ? { ...g, ...patch } : g)),
      }));
    },
    [commitProjectEdit]
  );

  const handleAddGraphic = useCallback(() => {
    commitProjectEdit((prev) => {
      const start = clamp(currentTimeSec, 0, Math.max(0, prev.metadata.durationSec - 0.5));
      const end = clamp(start + 2.0, start + 0.4, prev.metadata.durationSec);
      const newItem: MotionGraphicItem = {
        id: `gfx-${Date.now()}`,
        text: 'WATCH THIS EDIT',
        type: 'Caption',
        isCaption: true,
        trackId: 'V3',
        startTimeSec: Number(start.toFixed(2)),
        endTimeSec: Number(end.toFixed(2)),
        fontFamily: 'Outfit',
        fontSize: 48,
        fontWeight: 900,
        positionXPercent: 50,
        positionYPercent: 76,
        colorHex: '#FFFFFF',
        outlineColorHex: '#000000',
        outlineWidthPx: 4,
        backgroundColorHex: '#000000',
        backgroundOpacity: 0,
        highlightColorHex: '#FACC15',
        highlightWord: 'WATCH',
        textTransform: 'uppercase',
        captionStylePreset: 'Bold Hormozi',
        hasShadow: true,
        animationType: 'Bounce Pop',
        animationDurationSec: 0.25,
        confidence: 'High',
        spellChecked: true,
        fontSubstituteNote: 'User-created styled & animated caption plate + .srt cue.',
      };
      setSelectedGraphicId(newItem.id);
      return {
        ...prev,
        motionGraphics: [...prev.motionGraphics, newItem],
      };
    });
  }, [commitProjectEdit, currentTimeSec]);

  const handleDeleteGraphic = useCallback(
    (gfxId: string) => {
      commitProjectEdit((prev) => ({
        ...prev,
        motionGraphics: prev.motionGraphics.filter((g) => g.id !== gfxId),
      }));
    },
    [commitProjectEdit]
  );

  const handleUpdateTracks = useCallback(
    (tracks: AudioTrackMix[]) => {
      commitProjectEdit((prev) => ({
        ...prev,
        audio: {
          ...prev.audio,
          tracks,
        },
      }));
    },
    [commitProjectEdit]
  );

  const handleUpdateAudioEffect = useCallback(
    (effectId: string, patch: Partial<AudioEffectItem>) => {
      commitProjectEdit((prev) => ({
        ...prev,
        audio: {
          ...prev.audio,
          audioEffects: (prev.audio.audioEffects ?? []).map((ef) =>
            ef.id === effectId ? { ...ef, ...patch } : ef
          ),
        },
      }));
    },
    [commitProjectEdit]
  );

  const handleToggleTrackMute = useCallback(
    (trackId: 'A1' | 'A2' | 'A3' | 'A4') => {
      commitProjectEdit((prev) => ({
        ...prev,
        audio: {
          ...prev.audio,
          tracks: prev.audio.tracks.map((t) =>
            t.id === trackId ? { ...t, muted: !t.muted } : t
          ),
        },
      }));
    },
    [commitProjectEdit]
  );

  const handleSplitAtPlayhead = useCallback(() => {
    commitProjectEdit((prev) => {
      const target = prev.shots.find(
        (s) => currentTimeSec > s.startTimeSec + 0.25 && currentTimeSec < s.endTimeSec - 0.25
      );
      if (!target) return prev;

      const splitPoint = Number(currentTimeSec.toFixed(3));
      const leftShot: ShotClip = {
        ...target,
        endTimeSec: splitPoint,
        sourceOutSec: splitPoint,
        durationSec: Number((splitPoint - target.startTimeSec).toFixed(3)),
      };
      const rightShot: ShotClip = {
        ...target,
        id: `shot-split-${Date.now()}`,
        name: `${target.name} (B)`,
        startTimeSec: splitPoint,
        sourceInSec: splitPoint,
        durationSec: Number((target.endTimeSec - splitPoint).toFixed(3)),
        keyframes: [],
      };

      const nextShots: ShotClip[] = [];
      for (const s of prev.shots) {
        if (s.id === target.id) {
          nextShots.push(leftShot, rightShot);
        } else {
          nextShots.push(s);
        }
      }
      return {
        ...prev,
        shots: nextShots.map((s, idx) => ({ ...s, index: idx })),
      };
    });
  }, [commitProjectEdit, currentTimeSec]);

  const handleTrimShotBoundary = useCallback(
    (shotId: string, edge: 'start' | 'end', newTimeSec: number) => {
      commitProjectEdit((prev) => {
        const idx = prev.shots.findIndex((s) => s.id === shotId);
        if (idx === -1) return prev;
        const shots = prev.shots.map((s) => ({ ...s }));
        if (edge === 'end' && idx < shots.length - 1) {
          const cur = shots[idx];
          const next = shots[idx + 1];
          const clamped = clamp(newTimeSec, cur.startTimeSec + 0.3, next.endTimeSec - 0.3);
          cur.endTimeSec = Number(clamped.toFixed(3));
          cur.sourceOutSec = cur.endTimeSec;
          cur.durationSec = Number((cur.endTimeSec - cur.startTimeSec).toFixed(3));
          next.startTimeSec = cur.endTimeSec;
          next.sourceInSec = next.startTimeSec;
          next.durationSec = Number((next.endTimeSec - next.startTimeSec).toFixed(3));
        }
        return { ...prev, shots };
      });
    },
    [commitProjectEdit]
  );

  const handleSnapAllCutsToBeats = useCallback(() => {
    commitProjectEdit((prev) => {
      if (!prev.audio.hasAudio || prev.audio.beats.length === 0 || prev.shots.length < 2) {
        return prev;
      }
      const shots = prev.shots.map((s) => ({ ...s }));
      for (let i = 1; i < shots.length; i++) {
        const prevShot = shots[i - 1];
        const cur = shots[i];
        let bestBeat = prev.audio.beats[0];
        let minDiff = Infinity;
        for (const b of prev.audio.beats) {
          const d = Math.abs(b.timeSec - cur.startTimeSec);
          if (d < minDiff) {
            minDiff = d;
            bestBeat = b;
          }
        }
        if (
          bestBeat &&
          bestBeat.timeSec > prevShot.startTimeSec + 0.35 &&
          bestBeat.timeSec < cur.endTimeSec - 0.35
        ) {
          const snapped = Number(bestBeat.timeSec.toFixed(3));
          prevShot.endTimeSec = snapped;
          prevShot.sourceOutSec = snapped;
          prevShot.durationSec = Number((snapped - prevShot.startTimeSec).toFixed(3));
          cur.startTimeSec = snapped;
          cur.sourceInSec = snapped;
          cur.durationSec = Number((cur.endTimeSec - snapped).toFixed(3));
          cur.beatAligned = true;
          cur.alignedBeatTimeSec = snapped;
        }
      }
      return { ...prev, shots };
    });
  }, [commitProjectEdit]);

  const handleStepFrame = useCallback(
    (deltaSec: number) => {
      setIsPlaying(false);
      setCurrentTimeSec((t) =>
        clamp(t + deltaSec, 0, activeProject?.metadata.durationSec ?? 10)
      );
    },
    [activeProject]
  );

  const renderRequiresProjectPrompt = () => (
    <div className="max-w-[640px] mx-auto px-8 py-20 text-center space-y-4">
      <div className="w-12 h-12 rounded-xl bg-[#13151B] border border-white/[0.08] flex items-center justify-center mx-auto">
        <Film className="w-6 h-6 text-[#9B82FF]" />
      </div>
      <h2 className="font-display text-[22px] font-semibold text-white">
        Load or Analyze a Video First
      </h2>
      <p className="text-[14px] text-[#A5ACBF] leading-relaxed">
        This workspace inspects your reconstructed timeline, audio beats, color histograms, and
        Premiere XML data. Paste an Instagram Reel URL, upload footage, or generate a local sample
        Reel to open this view.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => setActivePage('dashboard')}
          className="px-4 py-2 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4BF0] text-white text-[13px] font-medium"
        >
          Go to Dashboard
        </button>
        <button
          type="button"
          onClick={() => setActivePage('upload-video')}
          className="px-4 py-2 rounded-lg bg-[#1A1D26] hover:bg-[#232736] border border-white/[0.1] text-white text-[13px] font-medium"
        >
          Upload Video File
        </button>
      </div>
    </div>
  );

  const renderMainContent = () => {
    switch (activePage) {
      case 'dashboard':
        return (
          <DashboardView
            instagramUrl={instagramUrl}
            onInstagramUrlChange={setInstagramUrl}
            instagramResult={instagramResult}
            inspectingUrl={inspectingUrl}
            onInspectInstagramUrl={handleInspectInstagramUrl}
            onAnalyzeLink={() => handleAnalyzeInstagramLink()}
            onSelectVideoFile={(file, origin) => handleAnalyzeFile(file, origin)}
            onGenerateSampleReel={handleGenerateSampleReel}
            generatingSample={generatingSample}
            sampleProgress={sampleProgress}
            isAnalyzing={isAnalyzing}
            pipelineStages={pipelineStages}
            analysisError={analysisError}
            projects={projects}
            onOpenProject={handleOpenProject}
            onNavigate={setActivePage}
          />
        );

      case 'import-instagram':
        return (
          <ImportInstagramView
            instagramUrl={instagramUrl}
            onInstagramUrlChange={setInstagramUrl}
            result={instagramResult}
            inspecting={inspectingUrl}
            isAnalyzing={isAnalyzing}
            onInspect={handleInspectInstagramUrl}
            onAnalyzeLink={() => handleAnalyzeInstagramLink()}
            onUploadAuthorizedFile={(file) => handleAnalyzeFile(file, 'instagram-upload')}
          />
        );

      case 'upload-video':
        return (
          <UploadVideoView
            settings={settings}
            onUpdateSettings={setSettings}
            onStartAnalysis={(file) => handleAnalyzeFile(file, 'direct-upload')}
            isAnalyzing={isAnalyzing}
          />
        );

      case 'video-analysis':
        return (
          <VideoAnalysisView
            project={activeProject}
            pipelineStages={pipelineStages}
            isAnalyzing={isAnalyzing}
            analysisError={analysisError}
            onNavigate={setActivePage}
          />
        );

      case 'shot-breakdown':
        return activeProject ? (
          <ShotBreakdownView
            project={activeProject}
            onSelectShotAndEdit={(shotId, timeSec) => {
              setSelectedShotId(shotId);
              setCurrentTimeSec(timeSec);
              setActivePage('reconstruction-editor');
            }}
          />
        ) : (
          renderRequiresProjectPrompt()
        );

      case 'audio-analysis':
        return activeProject ? (
          <AudioAnalysisView
            project={activeProject}
            currentTimeSec={currentTimeSec}
            onSeek={setCurrentTimeSec}
            onUpdateTracks={handleUpdateTracks}
            onUpdateAudioEffect={handleUpdateAudioEffect}
          />
        ) : (
          renderRequiresProjectPrompt()
        );

      case 'color-analysis':
        return activeProject ? (
          <ColorAnalysisView
            project={activeProject}
            videoUrl={videoObjectUrl}
            onUpdateColorGrade={handleUpdateColorGrade}
          />
        ) : (
          renderRequiresProjectPrompt()
        );

      case 'effects-analysis':
        return activeProject ? (
          <EffectsAnalysisView
            project={activeProject}
            onUpdateEffect={handleUpdateEffect}
            onUpdateGraphic={handleUpdateGraphic}
            onAddGraphic={handleAddGraphic}
            onDeleteGraphic={handleDeleteGraphic}
          />
        ) : (
          renderRequiresProjectPrompt()
        );

      case 'reconstruction-editor':
        return activeProject ? (
          <ReconstructionEditorView
            project={activeProject}
            videoUrl={videoObjectUrl}
            currentTimeSec={currentTimeSec}
            isPlaying={isPlaying}
            selectedShotId={selectedShotId}
            selectedGraphicId={selectedGraphicId}
            selectedEffectId={selectedEffectId}
            onSelectShot={setSelectedShotId}
            onSelectGraphic={setSelectedGraphicId}
            onSelectEffect={setSelectedEffectId}
            onTimeUpdate={setCurrentTimeSec}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onStepFrame={handleStepFrame}
            onUpdateShot={handleUpdateShot}
            onUpdateColorGrade={handleUpdateColorGrade}
            onUpdateGraphic={handleUpdateGraphic}
            onUpdateEffect={handleUpdateEffect}
            onAddGraphic={handleAddGraphic}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onToggleTrackMute={handleToggleTrackMute}
            onTrimShotBoundary={handleTrimShotBoundary}
          />
        ) : (
          renderRequiresProjectPrompt()
        );

      case 'timeline-editor':
        return activeProject ? (
          <TimelineEditorView
            project={activeProject}
            videoUrl={videoObjectUrl}
            currentTimeSec={currentTimeSec}
            isPlaying={isPlaying}
            selectedShotId={selectedShotId}
            selectedGraphicId={selectedGraphicId}
            selectedEffectId={selectedEffectId}
            onSelectShot={setSelectedShotId}
            onSelectGraphic={setSelectedGraphicId}
            onSelectEffect={setSelectedEffectId}
            onTimeUpdate={setCurrentTimeSec}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onStepFrame={handleStepFrame}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onToggleTrackMute={handleToggleTrackMute}
            onTrimShotBoundary={handleTrimShotBoundary}
          />
        ) : (
          renderRequiresProjectPrompt()
        );

      case 'comparison':
        return activeProject ? (
          <ComparisonView
            project={activeProject}
            videoUrl={videoObjectUrl}
            currentTimeSec={currentTimeSec}
            isPlaying={isPlaying}
            onTimeUpdate={setCurrentTimeSec}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            onStepFrame={handleStepFrame}
            onSnapAllCutsToBeats={handleSnapAllCutsToBeats}
            onUpdateColorGrade={handleUpdateColorGrade}
          />
        ) : (
          renderRequiresProjectPrompt()
        );

      case 'premiere-export':
        return activeProject ? (
          <PremiereExportView
            project={activeProject}
            sourceFile={sourceFile}
            settings={settings}
            onUpdateSettings={setSettings}
          />
        ) : (
          renderRequiresProjectPrompt()
        );

      case 'project-history':
        return (
          <ProjectHistoryView
            projects={projects}
            activeProjectId={activeProject?.id ?? null}
            onOpenProject={handleOpenProject}
            onDeleteProject={handleDeleteProject}
          />
        );

      case 'settings':
        return (
          <SettingsView
            settings={settings}
            onUpdateSettings={setSettings}
            serverStatus={serverStatus}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#0C0D11] text-[#EDEEF2] flex">
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        activeProject={activeProject}
        isAnalyzing={isAnalyzing}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <TopBar
          activePage={activePage}
          activeProject={activeProject}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onNavigateExport={() => setActivePage('premiere-export')}
          onNavigateDashboard={() => setActivePage('dashboard')}
        />

        <main className="flex-1 min-w-0">{renderMainContent()}</main>
      </div>
    </div>
  );
}
