import { useState, useRef } from "react";
import {
  Folder as FolderIcon,
  FolderOpen,
  ChevronsUpDown,
  FolderPlus,
  Check,
} from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { basename } from "@renderer/lib/pathUtils";
import {
  FloatingMenu,
  MenuItem,
  MenuSeparator,
} from "@renderer/shared/components";
import type { MaekWorkspace } from "@shared/types";

interface FolderSelectorProps {
  /** Currently open folder name, or null if none */
  currentFolderName: string | null;
  /** Currently open folder path, or null if none */
  currentFolderPath: string | null;
  /** List of registered workspaces */
  workspaces: MaekWorkspace[];
  /** Callback to trigger folder open dialog */
  onOpenFolder: () => void;
  /** Callback when a workspace is selected from the list */
  onSelectWorkspace: (workspace: MaekWorkspace) => void;
  /** True while opening/scanning a folder */
  isLoading: boolean;
}

export function FolderSelector({
  currentFolderName,
  currentFolderPath,
  workspaces,
  onOpenFolder,
  onSelectWorkspace,
  isLoading,
}: FolderSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClose = () => setIsOpen(false);

  const handleOpenFolderClick = () => {
    handleClose();
    onOpenFolder();
  };

  const handleWorkspaceClick = (workspace: MaekWorkspace) => {
    handleClose();
    if (workspace.path !== currentFolderPath) {
      onSelectWorkspace(workspace);
    }
  };

  // Calculate menu position based on button
  const getMenuPosition = () => {
    if (!buttonRef.current) return null;
    const rect = buttonRef.current.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
  };

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        className={cn(
          "flex items-center gap-2 px-3 py-2 w-full min-w-0",
          "text-sm rounded-lg transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-maek-red/20",
          isLoading
            ? "text-muted-text/50 cursor-not-allowed"
            : "text-muted-text hover:bg-surface-overlay",
        )}
      >
        {/* Icon */}
        {currentFolderName ? (
          <FolderOpen className="w-4 h-4 shrink-0 text-maek-red" />
        ) : (
          <FolderIcon className="w-4 h-4 shrink-0" />
        )}

        {/* Folder Name or Placeholder */}
        <span className="flex-1 min-w-0 text-left truncate">
          {currentFolderName ? (
            <span className="font-medium text-neutral-ink">
              {currentFolderName}
            </span>
          ) : (
            <span className="text-muted-text">Select a folder...</span>
          )}
        </span>

        {/* Up/Down Arrow Icon */}
        <ChevronsUpDown className="w-4 h-4 shrink-0" />
      </button>

      {/* Dropdown Menu */}
      <FloatingMenu
        isOpen={isOpen}
        position={getMenuPosition()}
        onClose={handleClose}
        anchorRef={buttonRef}
        minWidth={200}
      >
        {/* Workspace List */}
        {workspaces.map((workspace) => {
          const isActive = workspace.path === currentFolderPath;
          return (
            <MenuItem
              key={workspace.path}
              icon={
                isActive ? (
                  <Check className="w-4 h-4 text-swiss-red" />
                ) : (
                  <FolderIcon className="w-4 h-4" />
                )
              }
              label={basename(workspace.path)}
              selected={isActive}
              onClick={() => handleWorkspaceClick(workspace)}
            />
          );
        })}

        {/* Divider (only if there are workspaces) */}
        {workspaces.length > 0 && <MenuSeparator />}

        {/* Open Folder Option */}
        <MenuItem
          icon={<FolderPlus className="w-4 h-4" />}
          label="Open Folder..."
          onClick={handleOpenFolderClick}
        />
      </FloatingMenu>
    </div>
  );
}
