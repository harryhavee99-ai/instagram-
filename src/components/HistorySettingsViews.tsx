import React, { useMemo, useState } from 'react';
import { FolderClock, Search, ShieldCheck, Trash2 } from 'lucide-react';
import type { AppSettings, ReelProject } from '../types/project';
import { formatFileSize, formatShortSec } from '../engine/formatters';

/* ===================== 1. PROJECT HISTORY VIEW ===================== */

interface ProjectHistoryViewProps {
  projects: ReelProject[];
  activeProjectId: string | null;
  onOpenProject: (project: ReelProject) => void;
  onDeleteProject: (id: string) => void;
}

export const ProjectHistoryView: React.FC<ProjectHistoryViewProps> = ({
  projects,
  activeProjectId,
  onOpenProject,
  onDeleteProject,
}) => {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.summary.styleLabel.toLowerCase().includes(q) ||
        p.metadata.fileName.toLowerCase().includes(q)
    );
  }, [projects, query]);

  return (
    <div className="max-w-[1160px] mx-auto px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-[26px] font-semibold text-white">Project History</h1>
          <p className="text-[14px] text-[#A5ACBF]">
            Saved reverse-engineered timelines, shot breakdowns, color profiles, and XMEML export
            configurations.
          </p>
        </div>

        <div className="relative w-72">
          <Search className="w-4 h-4 text-[#7F869B] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter projects..."
            className="w-full h-10 pl-9 pr-3 rounded-lg bg-[#13151B] border border-white/[0.1] text-[13px] text-white placeholder:text-[#62697D]"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl bg-[#13151B] border border-white/[0.08] p-12 text-center space-y-2">
          <FolderClock className="w-8 h-8 text-[#555C70] mx-auto" />
          <div className="text-[15px] font-medium text-white">No saved projects match</div>
          <p className="text-[13px] text-[#7F869B]">
            Analyzed videos are persisted automatically so you can revisit and export Premiere XML
            anytime.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-[#13151B] border border-white/[0.08] overflow-hidden">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.08] text-[12px] text-[#7F869B]">
                <th className="py-3 px-5 font-medium">Project</th>
                <th className="py-3 px-4 font-medium">Resolution</th>
                <th className="py-3 px-4 font-medium text-right">Shots</th>
                <th className="py-3 px-4 font-medium text-right">BPM</th>
                <th className="py-3 px-4 font-medium text-right">Duration</th>
                <th className="py-3 px-4 font-medium text-right">Match</th>
                <th className="py-3 px-5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className={activeProjectId === p.id ? 'bg-[#7C5CFF]/8' : 'hover:bg-white/[0.02]'}
                >
                  <td className="py-3 px-5">
                    <div className="font-medium text-white">{p.name}</div>
                    <div className="text-[12px] text-[#7F869B]">
                      {p.summary.styleLabel} · {formatFileSize(p.metadata.fileSizeBytes)} ·{' '}
                      {new Date(p.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-[12px] text-[#A5ACBF]">
                    {p.metadata.width}×{p.metadata.height} · {p.metadata.fps}fps
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
                  <td className="py-3 px-4 font-mono tabular-nums text-right text-[#9B82FF]">
                    {p.comparison.overallSimilarityScore}%
                  </td>
                  <td className="py-3 px-5 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenProject(p)}
                        className="px-3 py-1.5 rounded-md bg-[#1D202C] hover:bg-[#7C5CFF] text-[12px] font-medium text-white transition-colors"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteProject(p.id)}
                        title="Delete project"
                        className="p-1.5 rounded-md text-[#7F869B] hover:text-[#F87171] hover:bg-white/[0.06]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/* ===================== 2. SETTINGS VIEW ===================== */

interface SettingsViewProps {
  settings: AppSettings;
  onUpdateSettings: (next: AppSettings) => void;
  serverStatus: { geminiConfigured: boolean; metaOembedConfigured: boolean } | null;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  serverStatus,
}) => {
  return (
    <div className="max-w-[900px] mx-auto px-8 py-8 space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-[26px] font-semibold text-white">Studio Settings</h1>
        <p className="text-[14px] text-[#A5ACBF]">
          Configure sequence defaults, adaptive sampling fidelity, beat-sync tolerance, and
          Premiere Pro packaging preferences.
        </p>
      </div>

      {/* Analysis & Timeline Defaults */}
      <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-5">
        <h2 className="text-[15px] font-semibold text-white">Analysis & Timeline Defaults</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-[13px]">
          <div className="space-y-1.5">
            <label className="text-[12px] text-[#8E96AC]">Default Sequence Timebase</label>
            <select
              value={settings.defaultTimebase}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  defaultTimebase: Number(e.target.value) as AppSettings['defaultTimebase'],
                })
              }
              className="w-full h-10 px-3 rounded-lg bg-[#0B0C10] border border-white/[0.12] text-white"
            >
              <option value={24}>24 fps</option>
              <option value={25}>25 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
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
              className="w-full h-10 px-3 rounded-lg bg-[#0B0C10] border border-white/[0.12] text-white"
            >
              <option value="Fast Draft">Fast Draft</option>
              <option value="Balanced">Balanced</option>
              <option value="High Precision">High Precision</option>
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
              className="w-full h-10 px-3 rounded-lg bg-[#0B0C10] border border-white/[0.12] text-white"
            >
              <option value="540p Proxy">540p Proxy</option>
              <option value="720p Proxy">720p Proxy</option>
              <option value="Original">Original Quality</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[12px]">
              <span className="text-[#8E96AC]">Beat-Sync Tolerance</span>
              <span className="font-mono tabular-nums text-white">
                ±{settings.beatSnapToleranceMs} ms
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={180}
              step={10}
              value={settings.beatSnapToleranceMs}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  beatSnapToleranceMs: Number(e.target.value),
                })
              }
              className="w-full mt-2"
            />
          </div>
        </div>
      </section>

      {/* Server Integration Status (Read-Only, no API key input forms) */}
      <section className="rounded-xl bg-[#13151B] border border-white/[0.08] p-6 space-y-4">
        <h2 className="text-[15px] font-semibold text-white">Authorized Service Readiness</h2>
        <div className="divide-y divide-white/[0.06] text-[13px]">
          <div className="py-3 flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-white">Multimodal Video AI Engine</div>
              <div className="text-[12px] text-[#7F869B]">
                Server-side visual, OCR, and editing reverse-engineering endpoint
              </div>
            </div>
            <span
              className={`font-mono text-[12px] ${
                serverStatus?.geminiConfigured ? 'text-[#4ADE80]' : 'text-[#FBBF24]'
              }`}
            >
              {serverStatus?.geminiConfigured ? 'Configured' : 'Server secret missing'}
            </span>
          </div>
          <div className="py-3 flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-white">Meta Instagram oEmbed API</div>
              <div className="text-[12px] text-[#7F869B]">
                Optional server META_OEMBED_TOKEN for live Instagram preview thumbnails
              </div>
            </div>
            <span
              className={`font-mono text-[12px] ${
                serverStatus?.metaOembedConfigured ? 'text-[#4ADE80]' : 'text-[#A5ACBF]'
              }`}
            >
              {serverStatus?.metaOembedConfigured ? 'Configured' : 'Optional (Not set)'}
            </span>
          </div>
        </div>
      </section>

      {/* Rights Compliance */}
      <section className="rounded-xl bg-[#101218] border border-white/[0.08] p-5 flex items-start gap-3.5 text-[13px] text-[#A5ACBF]">
        <ShieldCheck className="w-5 h-5 text-[#3B82F6] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-medium text-white">Content Ownership & Licensing Discipline</div>
          <p className="leading-relaxed">
            Reel2Premiere AI is designed strictly for videos you own or are licensed to edit.
            Copyrighted music tracks are never falsely identified or redistributed; reference audio
            markers allow you to drop licensed stems directly onto Track A2 in Adobe Premiere Pro.
          </p>
        </div>
      </section>
    </div>
  );
};
