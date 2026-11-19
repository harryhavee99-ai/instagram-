import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileCode2,
  FolderArchive,
  Loader2,
  XCircle,
} from 'lucide-react';
import type { AppSettings, ReelProject } from '../types/project';
import {
  buildPremiereZipBlob,
  generateCubeLut,
  generatePremiereXmeml,
  generateReconstructionReportMarkdown,
  generateRelinkingGuide,
  triggerFileDownload,
} from '../engine/premiereXmlGenerator';

interface PremiereExportViewProps {
  project: ReelProject;
  sourceFile: File | null;
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
}

export const PremiereExportView: React.FC<PremiereExportViewProps> = ({
  project,
  sourceFile,
  settings,
  onUpdateSettings,
}) => {
  const [resolutionPreset, setResolutionPreset] = useState<'original' | '1080x1920' | '2160x3840' | '1920x1080'>('original');
  const [timebase, setTimebase] = useState<number>(project.metadata.fps || 30);
  const [packaging, setPackaging] = useState(false);
  const [copiedXml, setCopiedXml] = useState(false);
  const [lastExportStatus, setLastExportStatus] = useState<string | null>(null);

  const dims = useMemo(() => {
    if (resolutionPreset === '1080x1920') return { width: 1080, height: 1920 };
    if (resolutionPreset === '2160x3840') return { width: 2160, height: 3840 };
    if (resolutionPreset === '1920x1080') return { width: 1920, height: 1080 };
    return { width: project.metadata.width, height: project.metadata.height };
  }, [resolutionPreset, project.metadata.width, project.metadata.height]);

  const xmlPreview = useMemo(
    () =>
      generatePremiereXmeml(project, {
        timebaseOverride: timebase,
        widthOverride: dims.width,
        heightOverride: dims.height,
      }),
    [project, timebase, dims.width, dims.height]
  );

  const handleDownloadZip = async () => {
    setPackaging(true);
    setLastExportStatus(null);
    try {
      const pkg = await buildPremiereZipBlob(project, {
        sourceFile,
        includeSourceMedia: settings.includeSourceMediaInZip,
        includeCubeLut: settings.autoGenerateCubeLut,
        timebaseOverride: timebase,
        widthOverride: dims.width,
        heightOverride: dims.height,
      });
      triggerFileDownload(pkg.blob, pkg.fileName, 'application/zip');
      setLastExportStatus(
        `Exported ${pkg.fileName} (${(pkg.blob.size / 1024).toFixed(1)} KB) with valid FCP 7 XMEML v4 XML.`
      );
    } catch (err) {
      setLastExportStatus(
        `Export failed: ${err instanceof Error ? err.message : 'Unable to assemble ZIP'}`
      );
    } finally {
      setPackaging(false);
    }
  };

  return (
    <div className="max-w-[1180px] mx-auto px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-[26px] font-semibold text-white">
            Export Adobe Premiere Project
          </h1>
          <p className="text-[14px] text-[#A5ACBF]">
            Generates a real Final Cut Pro 7 XML (XMEML v4) interchange project directly importable
            via <span className="text-white">File &gt; Import</span> in Adobe Premiere Pro, bundled
            with LUTs, vector graphics, manifests, and relinking guide.
          </p>
        </div>

        <button
          type="button"
          disabled={packaging}
          onClick={handleDownloadZip}
          className="px-5 py-2.5 rounded-lg bg-[#7C5CFF] hover:bg-[#6D4BF0] disabled:opacity-45 text-white text-[14px] font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap"
        >
          {packaging ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Packaging ZIP…</span>
            </>
          ) : (
            <>
              <FolderArchive className="w-4 h-4" />
              <span>Export Adobe Premiere Project (.zip)</span>
            </>
          )}
        </button>
      </div>

      {lastExportStatus && (
        <div className="rounded-lg bg-[#0F1914] border border-[#16A34A]/40 px-4 py-3 text-[13px] text-[#BBF7D0] flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
          <span>{lastExportStatus}</span>
        </div>
      )}

      {/* Sequence Configuration + Individual Asset Downloads */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-5">
          <h2 className="text-[15px] font-semibold text-white">Sequence & Package Settings</h2>

          <div className="space-y-3 text-[13px]">
            <div className="space-y-1.5">
              <label className="text-[12px] text-[#8E96AC]">Sequence Resolution</label>
              <select
                value={resolutionPreset}
                onChange={(e) =>
                  setResolutionPreset(e.target.value as typeof resolutionPreset)
                }
                className="w-full h-10 px-3 rounded-lg bg-[#0B0C10] border border-white/[0.12] text-white"
              >
                <option value="original">
                  Match Source ({project.metadata.width}×{project.metadata.height})
                </option>
                <option value="1080x1920">1080×1920 (Full HD 9:16 Vertical)</option>
                <option value="2160x3840">2160×3840 (4K UHD 9:16 Vertical)</option>
                <option value="1920x1080">1920×1080 (Full HD 16:9 Landscape)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[12px] text-[#8E96AC]">Sequence Timebase</label>
              <select
                value={timebase}
                onChange={(e) => setTimebase(Number(e.target.value))}
                className="w-full h-10 px-3 rounded-lg bg-[#0B0C10] border border-white/[0.12] text-white"
              >
                <option value={24}>24 fps</option>
                <option value={25}>25 fps</option>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </div>

            <label className="flex items-center justify-between gap-3 pt-2 cursor-pointer">
              <div>
                <div className="text-white font-medium">Bundle authorized source video in ZIP</div>
                <div className="text-[11px] text-[#7F869B]">
                  {sourceFile
                    ? `Includes Media/${sourceFile.name} for one-click Premiere relinking`
                    : 'No local video buffer attached (reopened from history)'}
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.includeSourceMediaInZip && Boolean(sourceFile)}
                disabled={!sourceFile}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, includeSourceMediaInZip: e.target.checked })
                }
                className="w-4 h-4 accent-[#7C5CFF]"
              />
            </label>

            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-white font-medium">Include 17×17×17 .cube 3D LUT</div>
                <div className="text-[11px] text-[#7F869B]">
                  Exports Lumetri-compatible look to LUTs/Reconstructed_Look.cube
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.autoGenerateCubeLut}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, autoGenerateCubeLut: e.target.checked })
                }
                className="w-4 h-4 accent-[#7C5CFF]"
              />
            </label>
          </div>

          {/* Individual Direct Downloads */}
          <div className="pt-4 border-t border-white/[0.08] space-y-2">
            <div className="text-[12px] font-medium text-[#8E96AC]">Download Individual Files</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(xmlPreview, `${project.name}_Premiere.xml`, 'application/xml')
                }
                className="px-3 py-2 rounded-lg bg-[#0C0D11] hover:bg-[#1A1D26] border border-white/[0.1] text-[12px] text-white inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-[#9B82FF]" />
                <span>Premiere .xml</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    generateCubeLut(project.colorGrade, project.name),
                    `${project.name}_Look.cube`,
                    'text/plain'
                  )
                }
                className="px-3 py-2 rounded-lg bg-[#0C0D11] hover:bg-[#1A1D26] border border-white/[0.1] text-[12px] text-white inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Color .cube LUT</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    generateReconstructionReportMarkdown(project),
                    `${project.name}_Report.md`,
                    'text/markdown'
                  )
                }
                className="px-3 py-2 rounded-lg bg-[#0C0D11] hover:bg-[#1A1D26] border border-white/[0.1] text-[12px] text-white inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-[#A5ACBF]" />
                <span>Report .md</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    generateRelinkingGuide(project),
                    `README_RELINKING_GUIDE.txt`,
                    'text/plain'
                  )
                }
                className="px-3 py-2 rounded-lg bg-[#0C0D11] hover:bg-[#1A1D26] border border-white/[0.1] text-[12px] text-white inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-[#A5ACBF]" />
                <span>Relinking Guide</span>
              </button>
            </div>
          </div>
        </div>

        {/* Premiere Compatibility Report */}
        <div className="lg:col-span-7 rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-white">
                Adobe Premiere Pro Compatibility Report
              </h2>
              <p className="text-[12px] text-[#8E96AC]">
                Validates FCP 7 XMEML v4 interchange fidelity without fabricating unsupported plugin
                parameters.
              </p>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[#7F869B]">Native Coverage</div>
              <div className="text-[22px] font-mono tabular-nums font-semibold text-[#4ADE80]">
                {project.compatibility.nativeCoveragePercent}%
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[12px]">
            <div className="p-3.5 rounded-lg bg-[#0C0D11] border border-white/[0.08] space-y-1.5">
              <div className="font-medium text-[#4ADE80] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Fully Reconstructed (Native)</span>
              </div>
              <ul className="space-y-1 text-[#C6CBD9]">
                {project.compatibility.fullyReconstructed.map((item, i) => (
                  <li key={i}>• {item}</li>
                ))}
              </ul>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0C0D11] border border-white/[0.08] space-y-1.5">
              <div className="font-medium text-[#FBBF24] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Approximate Reconstructions</span>
              </div>
              <ul className="space-y-1 text-[#C6CBD9]">
                {project.compatibility.approximate.map((item, i) => (
                  <li key={i}>• {item}</li>
                ))}
              </ul>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0C0D11] border border-white/[0.08] space-y-1.5">
              <div className="font-medium text-[#F87171] flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5" />
                <span>Unsupported / Missing Assets</span>
              </div>
              <ul className="space-y-1 text-[#C6CBD9]">
                {[
                  ...project.compatibility.unsupported,
                  ...project.compatibility.missingAssets,
                ].map((item, i) => (
                  <li key={i}>• {item}</li>
                ))}
              </ul>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0C0D11] border border-white/[0.08] space-y-1.5">
              <div className="font-medium text-[#93C5FD]">Required Manual Adjustments</div>
              <ul className="space-y-1 text-[#C6CBD9]">
                {project.compatibility.manualAdjustments.map((item, i) => (
                  <li key={i}>• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Live FCP 7 XMEML v4 Inspector */}
      <section className="rounded-xl bg-[#13151B] border border-white/[0.08] overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-[13px]">
            <FileCode2 className="w-4 h-4 text-[#9B82FF]" />
            <span className="font-medium text-white">
              FCP 7 XMEML v4 Output Preview ({xmlPreview.split('\n').length} lines)
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(xmlPreview);
              setCopiedXml(true);
              window.setTimeout(() => setCopiedXml(false), 1800);
            }}
            className="px-3 py-1.5 rounded-md bg-[#1A1D26] hover:bg-[#232736] text-[12px] text-white inline-flex items-center gap-1.5"
          >
            {copiedXml ? <Check className="w-3.5 h-3.5 text-[#4ADE80]" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedXml ? 'Copied XML' : 'Copy XML'}</span>
          </button>
        </div>
        <pre className="p-4 bg-[#08090C] text-[12px] font-mono text-[#B7C0D6] overflow-x-auto max-h-[340px] leading-relaxed">
          {xmlPreview}
        </pre>
      </section>
    </div>
  );
};
