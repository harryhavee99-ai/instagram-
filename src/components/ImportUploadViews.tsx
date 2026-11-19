import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileVideo,
  Instagram,
  Loader2,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import type { AppSettings, InstagramInspectResult } from '../types/project';
import { formatFileSize, inferContainerAndCodec } from '../engine/formatters';

interface ImportInstagramViewProps {
  instagramUrl: string;
  onInstagramUrlChange: (url: string) => void;
  result: InstagramInspectResult | null;
  inspecting: boolean;
  onInspect: (url: string) => Promise<void>;
  onUploadAuthorizedFile: (file: File) => void;
}

export const ImportInstagramView: React.FC<ImportInstagramViewProps> = ({
  instagramUrl,
  onInstagramUrlChange,
  result,
  inspecting,
  onInspect,
  onUploadAuthorizedFile,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="max-w-[960px] mx-auto px-8 py-8 space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-display text-[26px] font-semibold text-white">
          Import Instagram Reel or Video Post
        </h1>
        <p className="text-[14px] text-[#A5ACBF]">
          Validate an Instagram Reel, Video Post, or IGTV link through authorized Meta oEmbed
          inspection and pair it with your authorized media file for frame-accurate reconstruction.
        </p>
      </div>

      {/* URL Input Panel */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onInspect(instagramUrl);
        }}
        className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4"
      >
        <label className="block text-[13px] font-medium text-[#D4D8E3]">
          Instagram Reel or Post URL
        </label>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Instagram className="w-4 h-4 text-[#7F869B] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={instagramUrl}
              onChange={(e) => onInstagramUrlChange(e.target.value)}
              placeholder="https://www.instagram.com/reel/C9Example123/"
              className="w-full h-11 pl-10 pr-4 rounded-lg bg-[#0B0C10] border border-white/[0.12] text-[14px] text-white placeholder:text-[#5E6578] focus:outline-none focus:border-[#7C5CFF]"
            />
          </div>
          <button
            type="submit"
            disabled={inspecting || !instagramUrl.trim()}
            className="h-11 px-5 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4BF0] disabled:opacity-45 text-white text-[13px] font-medium inline-flex items-center justify-center gap-2 whitespace-nowrap"
          >
            {inspecting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Validate & Inspect URL</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#7F869B]">
          <span>Supported: instagram.com/reel/…</span>
          <span aria-hidden="true">·</span>
          <span>instagram.com/p/…</span>
          <span aria-hidden="true">·</span>
          <span>instagram.com/tv/…</span>
        </div>
      </form>

      {/* Inspection Output */}
      {result && (
        <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {result.valid ? (
                <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-[#DC2626] shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <h2 className="text-[16px] font-semibold text-white">
                  {result.valid
                    ? `Validated ${result.contentType} (${result.shortcode})`
                    : 'URL Validation Failed'}
                </h2>
                <p className="text-[13px] text-[#A5ACBF] leading-relaxed">
                  {result.accessNotice}
                </p>
              </div>
            </div>
          </div>

          {result.valid && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2 border-t border-white/[0.08]">
              {/* Preview Thumbnail if returned by Meta oEmbed */}
              <div className="rounded-lg bg-[#0B0C10] border border-white/[0.08] overflow-hidden flex items-center justify-center min-h-[180px]">
                {result.metadata?.thumbnailUrl ? (
                  <img
                    src={result.metadata.thumbnailUrl}
                    alt={result.metadata.title || 'Instagram media thumbnail'}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="p-4 text-center space-y-1.5">
                    <Instagram className="w-6 h-6 text-[#555C70] mx-auto" />
                    <div className="text-[12px] text-[#8E96AC]">
                      {result.oEmbedConfigured
                        ? 'Preview thumbnail unavailable'
                        : 'Configure META_OEMBED_TOKEN for live oEmbed thumbnail'}
                    </div>
                  </div>
                )}
              </div>

              {/* Metadata Grid */}
              <div className="md:col-span-2 grid grid-cols-2 gap-4 text-[13px]">
                <div>
                  <div className="text-[11px] text-[#7F869B]">Content Type</div>
                  <div className="font-medium text-white mt-0.5">{result.contentType}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7F869B]">Shortcode</div>
                  <div className="font-mono text-white mt-0.5">{result.shortcode}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7F869B]">Creator / Source</div>
                  <div className="text-white mt-0.5 truncate">
                    {result.metadata?.authorName || result.creatorHandle || 'Not exposed'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7F869B]">Aspect Ratio</div>
                  <div className="font-mono text-white mt-0.5">
                    {result.metadata?.aspectRatio || '9:16'}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[11px] text-[#7F869B]">Direct Video Stream Access</div>
                  <div className="text-[#FDE68A] mt-0.5">
                    Not provided by Instagram oEmbed — upload your authorized video file to begin
                    frame-level analysis
                  </div>
                </div>
              </div>
            </div>
          )}

          {result.valid && (
            <div className="pt-3 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
              <div className="text-[12px] text-[#8E96AC]">
                Attach the original video file associated with this link to start the 11-stage
                reverse-engineering pipeline.
              </div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4BF0] text-white text-[13px] font-medium inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Authorized Source Video</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="video/*,.mp4,.mov,.mkv,.avi,.webm,.m4v,.mpeg,.mpg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadAuthorizedFile(file);
                  e.target.value = '';
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Rights & Authorized Access Notice */}
      <div className="rounded-xl bg-[#101218] border border-white/[0.08] p-5 flex items-start gap-3.5 text-[13px] text-[#A5ACBF]">
        <ShieldCheck className="w-5 h-5 text-[#3B82F6] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-medium text-white">Authorized Access & Rights Policy</div>
          <p className="leading-relaxed">
            Reel2Premiere AI strictly respects Meta platform terms, private account boundaries, and
            DRM protections. It never scrapes private videos or bypasses authentication. Only
            analyze and reconstruct videos you own or are explicitly licensed to edit.
          </p>
        </div>
      </div>
    </div>
  );
};

interface UploadVideoViewProps {
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  onStartAnalysis: (file: File) => void;
  isAnalyzing: boolean;
}

export const UploadVideoView: React.FC<UploadVideoViewProps> = ({
  settings,
  onUpdateSettings,
  onStartAnalysis,
  isAnalyzing,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const probe = selectedFile ? inferContainerAndCodec(selectedFile) : null;

  return (
    <div className="max-w-[960px] mx-auto px-8 py-8 space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-display text-[26px] font-semibold text-white">
          Upload Authorized Video Footage
        </h1>
        <p className="text-[14px] text-[#A5ACBF]">
          Import original footage up to 4K for adaptive frame sampling, shot boundary detection,
          Web Audio beat tracking, Lumetri color estimation, and Premiere XML reconstruction.
        </p>
      </div>

      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const f = e.dataTransfer.files?.[0];
          if (f) setSelectedFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        className={`rounded-xl border-2 border-dashed p-12 text-center cursor-pointer transition-colors space-y-3 ${
          dragActive
            ? 'border-[#7C5CFF] bg-[#7C5CFF]/10'
            : 'border-white/[0.14] bg-[#13151B] hover:border-white/[0.28]'
        }`}
      >
        <div className="w-12 h-12 rounded-xl bg-[#1A1D26] flex items-center justify-center mx-auto">
          <Upload className="w-6 h-6 text-[#9B82FF]" />
        </div>
        <div className="text-[16px] font-medium text-white">
          {selectedFile ? selectedFile.name : 'Drag and drop video file here, or click to select'}
        </div>
        <div className="text-[13px] text-[#8E96AC]">
          MP4 · MOV · MKV · AVI · WebM · M4V · MPEG · ProRes MOV
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mp4,.mov,.mkv,.avi,.webm,.m4v,.mpeg,.mpg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setSelectedFile(f);
          }}
        />
      </div>

      {/* File Probe + Proxy / Sampling Controls */}
      <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-[12px] text-[#8E96AC]">Sequence Timebase</label>
            <select
              value={settings.defaultTimebase}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  defaultTimebase: Number(e.target.value) as AppSettings['defaultTimebase'],
                })
              }
              className="w-full h-10 px-3 rounded-lg bg-[#0B0C10] border border-white/[0.12] text-[13px] text-white"
            >
              <option value={24}>24 fps (Cinema)</option>
              <option value={25}>25 fps (PAL)</option>
              <option value={30}>30 fps (Social Standard)</option>
              <option value={60}>60 fps (High Frame Rate)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] text-[#8E96AC]">Adaptive Frame Sampling</label>
            <select
              value={settings.samplingDensity}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  samplingDensity: e.target.value as AppSettings['samplingDensity'],
                })
              }
              className="w-full h-10 px-3 rounded-lg bg-[#0B0C10] border border-white/[0.12] text-[13px] text-white"
            >
              <option value="Fast Draft">Fast Draft (Quick scan)</option>
              <option value="Balanced">Balanced (Recommended)</option>
              <option value="High Precision">High Precision (Dense cuts)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] text-[#8E96AC]">Timeline Proxy Preview</label>
            <select
              value={settings.proxyQuality}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  proxyQuality: e.target.value as AppSettings['proxyQuality'],
                })
              }
              className="w-full h-10 px-3 rounded-lg bg-[#0B0C10] border border-white/[0.12] text-[13px] text-white"
            >
              <option value="540p Proxy">540p Proxy (Fastest scrubbing)</option>
              <option value="720p Proxy">720p Proxy (Balanced)</option>
              <option value="Original">Original Quality</option>
            </select>
          </div>
        </div>

        {selectedFile && probe && (
          <div className="pt-4 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <FileVideo className="w-5 h-5 text-[#3B82F6]" />
              <div>
                <div className="text-[14px] font-medium text-white">{selectedFile.name}</div>
                <div className="text-[12px] font-mono tabular-nums text-[#8E96AC]">
                  {probe.container} · {probe.codec} · {formatFileSize(selectedFile.size)}
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={isAnalyzing}
              onClick={() => onStartAnalysis(selectedFile)}
              className="px-5 py-2.5 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4BF0] disabled:opacity-45 text-white text-[13px] font-medium transition-colors whitespace-nowrap"
            >
              {isAnalyzing ? 'Analyzing Video...' : 'Start Reverse-Engineering Analysis'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
