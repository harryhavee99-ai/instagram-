import React from 'react';
import {
  Activity,
  AudioWaveform,
  Clock,
  Columns2,
  Download,
  Film,
  FolderClock,
  Instagram,
  Layers,
  LayoutDashboard,
  Palette,
  Scissors,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from 'lucide-react';
import type { NavPage, ReelProject } from '../types/project';
import { formatShortSec } from '../engine/formatters';

interface SidebarProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  activeProject: ReelProject | null;
  isAnalyzing: boolean;
}

interface NavGroup {
  title: string;
  items: Array<{
    id: NavPage;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    requiresProject?: boolean;
  }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Workspace',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'import-instagram', label: 'Import Instagram', icon: Instagram },
      { id: 'upload-video', label: 'Upload Video', icon: Upload },
    ],
  },
  {
    title: 'AI Analysis',
    items: [
      { id: 'video-analysis', label: 'Video Analysis', icon: Activity },
      { id: 'shot-breakdown', label: 'Shot Breakdown', icon: Film, requiresProject: true },
      { id: 'audio-analysis', label: 'Audio Analysis', icon: AudioWaveform, requiresProject: true },
      { id: 'color-analysis', label: 'Color Analysis', icon: Palette, requiresProject: true },
      { id: 'effects-analysis', label: 'Effects Analysis', icon: Sparkles, requiresProject: true },
    ],
  },
  {
    title: 'Reconstruction',
    items: [
      { id: 'reconstruction-editor', label: 'Reconstruction Editor', icon: SlidersHorizontal, requiresProject: true },
      { id: 'timeline-editor', label: 'Timeline Editor', icon: Layers, requiresProject: true },
      { id: 'comparison', label: 'Original vs Reconstructed', icon: Columns2, requiresProject: true },
    ],
  },
  {
    title: 'Delivery',
    items: [
      { id: 'premiere-export', label: 'Premiere XML Export', icon: Download, requiresProject: true },
      { id: 'project-history', label: 'Project History', icon: FolderClock },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onNavigate,
  activeProject,
  isAnalyzing,
}) => {
  return (
    <aside className="w-[248px] shrink-0 bg-[#101218] border-r border-white/[0.08] flex flex-col h-screen sticky top-0 select-none">
      {/* Brand Wordmark */}
      <div className="h-14 px-5 flex items-center gap-2.5 border-b border-white/[0.08]">
        <div className="w-7 h-7 rounded-lg bg-[#7C5CFF] flex items-center justify-center shrink-0">
          <Scissors className="w-4 h-4 text-white" />
        </div>
        <span className="font-display font-semibold text-[16px] tracking-tight text-white whitespace-nowrap">
          Reel2Premiere AI
        </span>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="px-2.5 mb-1.5 text-[11px] font-medium text-[#7F869B] tracking-wide">
              {group.title}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                const disabled = Boolean(item.requiresProject && !activeProject);

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap text-left focus-visible:outline-2 focus-visible:outline-[#7C5CFF] ${
                      isActive
                        ? 'bg-[#7C5CFF]/15 text-white'
                        : disabled
                        ? 'text-[#555C70] hover:text-[#8E96AC] hover:bg-white/[0.03]'
                        : 'text-[#A5ACBF] hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive
                          ? 'text-[#9B82FF]'
                          : disabled
                          ? 'text-[#4B5164]'
                          : 'text-[#7F869B]'
                      }`}
                    />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Active Sequence Summary Footer */}
      <div className="p-4 border-t border-white/[0.08] bg-[#0C0D11]">
        {isAnalyzing ? (
          <div className="space-y-1">
            <div className="text-[12px] font-medium text-[#9B82FF] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 animate-spin" />
              <span>Analyzing media...</span>
            </div>
            <p className="text-[11px] text-[#7F869B]">
              Inspecting frames, beats, and cuts
            </p>
          </div>
        ) : activeProject ? (
          <div className="space-y-1">
            <div className="text-[12px] font-medium text-white truncate">
              {activeProject.name}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-[#8E96AC]">
              {activeProject.metadata.width}×{activeProject.metadata.height} ·{' '}
              {activeProject.metadata.fps}fps · {formatShortSec(activeProject.metadata.durationSec)}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-[#6E768C]">
              {activeProject.shots.length} shots ·{' '}
              {activeProject.audio.hasAudio ? `${activeProject.audio.estimatedBpm} BPM` : 'No audio'}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-[#6E768C] leading-relaxed">
            No active sequence loaded. Import a Reel URL or upload video footage to begin.
          </div>
        )}
      </div>
    </aside>
  );
};
