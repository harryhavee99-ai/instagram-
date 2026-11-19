import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  Film,
  Instagram,
  Loader2,
  Upload,
} from 'lucide-react';
import type {
  AnalysisPipelineStage,
  InstagramInspectResult,
  NavPage,
  ReelProject,
} from '../types/project';
import { formatFileSize, formatShortSec } from '../engine/formatters';

interface DashboardViewProps {
  instagramUrl: string;
  onInstagramUrlChange: (url: string) => void;
  instagramResult: InstagramInspectResult | null;
  inspectingUrl: boolean;
  onInspectInstagramUrl: (url: string) => Promise<void>;
  onSelectVideoFile: (file: File, origin: 'instagram-upload' | 'direct-upload') => void;
  onGenerateSampleReel: () => Promise<void>;
  generatingSample: boolean;
  sampleProgress: number;
  isAnalyzing: boolean;
  pipelineStages: AnalysisPipelineStage[];
  analysisError: string | null;
  projects: ReelProject[];
  onOpenProject: (project: ReelProject) => void;
  onNavigate: (page: NavPage) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  instagramUrl,
  onInstagramUrlChange,
  instagramResult,
  inspectingUrl,
  onInspectInstagramUrl,
  onSelectVideoFile,
  onGenerateSampleReel,
  generatingSample,
  sampleProgress,
  isAnalyzing,
  pipelineStages,
  analysisError,
  projects,
  onOpenProject,
  onNavigate,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleSubmitUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instagramUrl.trim()) return;
    await onInspectInstagramUrl(instagramUrl);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onSelectVideoFile(file, instagramResult?.valid ? 'instagram-upload' : 'direct-upload');
    }
  };

  const completedStages = pipelineStages.filter(
    (s) => s.status === 'done' || s.status === 'warning'
  ).length;

  return (
    <div className="max-w-[1160px] mx-auto px-8 py-8 space-y-8">
      {/* Primary Hero & URL Import Anchor */}
      <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-8 space-y-6">
        <div className="max-w-2xl space-y-2.5">
          <h1 className="font-display text-[32px] font-semibold tracking-tight text-white leading-[1.15]">
            Reverse-engineer any short-form video into an editable Premiere Pro timeline
          </h1>
          <p className="text-[15px] text-[#A5ACBF] leading-relaxed">
            Paste an Instagram Reel URL or upload your authorized source footage. Reel2Premiere AI
            extracts shot cuts, beats, color histograms, motion keyframes, and visible typography to
            build an importable FCP 7 XMEML project package.
          </p>
        </div>

        {/* Large URL Input + Obvious Analyze Video Button */}
        <form onSubmit={handleSubmitUrl} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Instagram className="w-4 h-4 text-[#7F869B] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={instagramUrl}
              onChange={(e) => onInstagramUrlChange(e.target.value)}
              placeholder="Paste Instagram Reel or Video URL (e.g. https://www.instagram.com/reel/C8xYz123AbC/)"
              className="w-full h-12 pl-11 pr-4 rounded-lg bg-[#0B0C10] border border-white/[0.12] text-[14px] text-white placeholder:text-[#62697D] focus:outline-none focus:border-[#7C5CFF] transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={inspectingUrl || isAnalyzing || !instagramUrl.trim()}
            className="h-12 px-6 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4BF0] disabled:opacity-45 text-white text-[14px] font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            {inspectingUrl ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Validating URL</span>
              </>
            ) : (
              <>
                <span>Analyze Video</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Instagram Validation & Authorized Access Response */}
        {instagramResult && (
          <div
            className={`rounded-lg p-4 border text-[13px] space-y-2.5 ${
              instagramResult.valid
                ? 'bg-[#0F131D] border-[#3B82F6]/35 text-[#D4D8E3]'
                : 'bg-[#1D1114] border-[#DC2626]/40 text-[#FCA5A5]'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2.5">
                {instagramResult.valid ? (
                  <CheckCircle2 className="w-4 h-4 text-[#3B82F6] shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <div className="font-medium text-white">
                    {instagramResult.valid
                      ? `${instagramResult.contentType} Validated — Shortcode ${instagramResult.shortcode}`
                      : 'Invalid Instagram URL'}
                  </div>
                  <p className="text-[#A5ACBF] leading-relaxed">{instagramResult.accessNotice}</p>
                  {instagramResult.valid && instagramResult.metadata && (
                    <div className="space-y-1 pt-0.5">
                      <div className="text-[12px] font-mono tabular-nums text-[#8E96AC]">
                        {instagramResult.metadata.authorName} · {instagramResult.metadata.aspectRatio} ·{' '}
                        {instagramResult.normalizedUrl}
                      </div>
                      {(instagramResult.metadata.caption || instagramResult.metadata.title) && (
                        <div className="text-[12px] text-[#C6CBD9] line-clamp-2">
                          {instagramResult.metadata.caption || instagramResult.metadata.title}
                        </div>
                      )}
                      {instagramResult.metadata.hashtags &&
                        instagramResult.metadata.hashtags.length > 0 && (
                          <div className="text-[11px] font-mono text-[#9B82FF] truncate">
                            {instagramResult.metadata.hashtags.join('  ')}
                          </div>
                        )}
                    </div>
                  )}
                </div>
              </div>
              {instagramResult.valid && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-2 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white text-[12px] font-medium whitespace-nowrap shrink-0 transition-colors"
                >
                  Attach Authorized Video
                </button>
              )}
            </div>
          </div>
        )}

        {/* Secondary Action Row: Upload File Dropzone + Instant Local Sample Reel */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
            }}
            className={`lg:col-span-2 rounded-lg border border-dashed p-5 flex items-center justify-between gap-4 cursor-pointer transition-colors ${
              dragActive
                ? 'border-[#7C5CFF] bg-[#7C5CFF]/10'
                : 'border-white/[0.14] bg-[#0C0D11] hover:border-white/[0.28]'
            }`}
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-[#1A1D26] flex items-center justify-center shrink-0">
                <Upload className="w-5 h-5 text-[#9B82FF]" />
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-white">
                  Drop an authorized video file or click to browse
                </div>
                <div className="text-[12px] text-[#7F869B] truncate">
                  MP4 · MOV · WebM · M4V · MKV · AVI · MPEG · ProRes MOV (up to 4K)
                </div>
              </div>
            </div>
            <span className="text-[12px] font-medium text-[#9B82FF] whitespace-nowrap shrink-0">
              Select File
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,.mp4,.mov,.mkv,.avi,.webm,.m4v,.mpeg,.mpg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onSelectVideoFile(
                    file,
                    instagramResult?.valid ? 'instagram-upload' : 'direct-upload'
                  );
                }
                e.target.value = '';
              }}
            />
          </div>

          <div className="rounded-lg bg-[#0C0D11] border border-white/[0.08] p-5 flex flex-col justify-between gap-3">
            <div>
              <div className="text-[13px] font-medium text-white flex items-center gap-2">
                <Clapperboard className="w-4 h-4 text-[#3B82F6]" />
                <span>Test End-to-End Pipeline</span>
              </div>
              <p className="text-[12px] text-[#7F869B] mt-1 leading-relaxed">
                Synthesize a real 9:16 multi-shot 120 BPM video locally to inspect full CV, audio,
                Gemini AI, and Premiere XML output.
              </p>
            </div>
            <button
              type="button"
              disabled={generatingSample || isAnalyzing}
              onClick={onGenerateSampleReel}
              className="w-full py-2 px-3.5 rounded-lg bg-[#1A1D26] hover:bg-[#232736] border border-white/[0.1] text-[12px] font-medium text-white disabled:opacity-45 transition-colors flex items-center justify-center gap-2"
            >
              {generatingSample ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9B82FF]" />
                  <span className="font-mono tabular-nums">Rendering {sampleProgress}%</span>
                </>
              ) : (
                <span>Generate Sample Reel (Local)</span>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Active Analysis Progress or Error */}
      {(isAnalyzing || analysisError) && (
        <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-[16px] font-semibold text-white">
                {analysisError ? 'Analysis Halted' : 'Processing Pipeline Active'}
              </h2>
              <p className="text-[13px] text-[#8E96AC]">
                {analysisError
                  ? analysisError
                  : `Stage ${Math.min(11, completedStages + 1)} of 11 executing real frame, audio, and multimodal analysis.`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('video-analysis')}
              className="text-[12px] font-medium text-[#9B82FF] hover:text-white transition-colors whitespace-nowrap"
            >
              View Full Stage Log
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {pipelineStages.map((stage) => (
              <div
                key={stage.id}
                className={`px-3 py-2.5 rounded-lg border text-[12px] ${
                  stage.status === 'done'
                    ? 'bg-[#0F1914] border-[#16A34A]/35 text-[#BBF7D0]'
                    : stage.status === 'warning'
                    ? 'bg-[#1B170F] border-[#D97706]/45 text-[#FDE68A]'
                    : stage.status === 'active'
                    ? 'bg-[#171329] border-[#7C5CFF]/55 text-white'
                    : stage.status === 'error'
                    ? 'bg-[#1F1215] border-[#DC2626]/50 text-[#FCA5A5]'
                    : 'bg-[#0C0D11] border-white/[0.06] text-[#6E768C]'
                }`}
              >
                <div className="font-medium truncate">
                  {stage.id}. {stage.label}
                </div>
                {stage.detail && (
                  <div className="text-[11px] opacity-80 truncate mt-0.5 font-mono" title={stage.detail}>
                    {stage.detail}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent Reconstructed Projects */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-white">Recent Reconstructed Projects</h2>
          {projects.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('project-history')}
              className="text-[13px] text-[#9B82FF] hover:text-white transition-colors"
            >
              View All ({projects.length})
            </button>
          )}
        </div>

        {projects.length === 0 ? (
          <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-10 text-center space-y-2">
            <Film className="w-7 h-7 text-[#555C70] mx-auto" />
            <div className="text-[14px] font-medium text-white">No analyzed projects yet</div>
            <p className="text-[13px] text-[#7F869B] max-w-md mx-auto">
              Upload an authorized video or generate a local sample Reel above. Completed timeline
              reconstructions and Premiere XML configurations appear here automatically.
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-[#13151B] border border-white/[0.08] overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] text-[12px] text-[#7F869B]">
                  <th className="py-3 px-4 font-medium">Project</th>
                  <th className="py-3 px-4 font-medium">Format</th>
                  <th className="py-3 px-4 font-medium text-right">Shots</th>
                  <th className="py-3 px-4 font-medium text-right">BPM</th>
                  <th className="py-3 px-4 font-medium text-right">Duration</th>
                  <th className="py-3 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06] text-[13px]">
                {projects.slice(0, 6).map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {p.shots[0]?.thumbnailDataUrl ? (
                          <img
                            src={p.shots[0].thumbnailDataUrl}
                            alt={p.name}
                            referrerPolicy="no-referrer"
                            className="w-8 h-11 object-cover rounded border border-white/[0.1] shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-11 rounded bg-[#1A1D26] shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-white truncate max-w-[260px]">
                            {p.name}
                          </div>
                          <div className="text-[12px] text-[#7F869B] truncate">
                            {p.summary.styleLabel} · {formatFileSize(p.metadata.fileSizeBytes)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[12px] text-[#A5ACBF]">
                      {p.metadata.width}×{p.metadata.height} · {p.metadata.aspectRatio}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-[#D4D8E3]">
                      {p.shots.length}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-[#D4D8E3]">
                      {p.audio.hasAudio ? p.audio.estimatedBpm : '—'}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-right text-[#D4D8E3]">
                      {formatShortSec(p.metadata.durationSec)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenProject(p)}
                        className="px-3 py-1.5 rounded-md bg-[#1D202C] hover:bg-[#7C5CFF] text-[12px] font-medium text-white transition-colors whitespace-nowrap"
                      >
                        Open Editor
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
