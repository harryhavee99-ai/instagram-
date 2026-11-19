import React from 'react';
import { Download, Redo2, Undo2 } from 'lucide-react';
import type { NavPage, ReelProject } from '../types/project';

const PAGE_TITLES: Record<NavPage, string> = {
  dashboard: 'Dashboard',
  'import-instagram': 'Import Instagram Video',
  'upload-video': 'Upload Video',
  'video-analysis': 'Video Analysis',
  'shot-breakdown': 'Shot Breakdown',
  'audio-analysis': 'Audio Analysis',
  'color-analysis': 'Color Analysis',
  'effects-analysis': 'Effects Analysis',
  'reconstruction-editor': 'Reconstruction Editor',
  'timeline-editor': 'Timeline Editor',
  comparison: 'Original vs Reconstructed',
  'premiere-export': 'Premiere XML Export',
  'project-history': 'Project History',
  settings: 'Settings',
};

interface TopBarProps {
  activePage: NavPage;
  activeProject: ReelProject | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onNavigateExport: () => void;
  onNavigateDashboard: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activePage,
  activeProject,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onNavigateExport,
  onNavigateDashboard,
}) => {
  const showHistoryControls =
    Boolean(activeProject) &&
    (activePage === 'reconstruction-editor' ||
      activePage === 'timeline-editor' ||
      activePage === 'color-analysis' ||
      activePage === 'comparison');

  return (
    <header className="h-14 shrink-0 bg-[#101218] border-b border-white/[0.08] px-6 flex items-center justify-between gap-8 sticky top-0 z-20">
      {/* Left: Contextual Breadcrumb Trail */}
      <div className="flex items-center gap-2 text-[13px] min-w-0">
        <button
          type="button"
          onClick={onNavigateDashboard}
          className="text-[#8E96AC] hover:text-white transition-colors whitespace-nowrap shrink-0"
        >
          Studio
        </button>
        <span className="text-[#4B5164]" aria-hidden="true">/</span>
        <span className="font-medium text-white whitespace-nowrap shrink-0">
          {PAGE_TITLES[activePage]}
        </span>
        {activeProject && (
          <>
            <span className="text-[#4B5164]" aria-hidden="true">/</span>
            <span className="text-[#A5ACBF] truncate max-w-[260px]">
              {activeProject.name}
            </span>
          </>
        )}
      </div>

      {/* Right: Primary Workspace Actions */}
      <div className="flex items-center gap-3 shrink-0">
        {showHistoryControls && (
          <div className="flex items-center gap-1 mr-1">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo edit"
              className="p-2 rounded-lg text-[#A5ACBF] hover:text-white hover:bg-white/[0.06] disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo edit"
              className="p-2 rounded-lg text-[#A5ACBF] hover:text-white hover:bg-white/[0.06] disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onNavigateExport}
          disabled={!activeProject}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-[#7C5CFF] hover:bg-[#6D4BF0] text-white disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-4 h-4 shrink-0" />
          <span>Export Premiere Project</span>
        </button>
      </div>
    </header>
  );
};
