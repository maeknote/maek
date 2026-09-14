import { useMemo } from "react";
import {
  Clock,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Moon,
  Sun,
  Trash2,
} from "lucide-react";
import { useStore, schedulePersistence } from "../../../store";
import { Button } from "../../../shared/components";

/**
 * Workspace dashboard — the web version's counterpart to the desktop
 * WorkspaceSettingsView. The web app has no SQLite database and no local
 * `.claude` settings, so this surface only manages workspace-level metadata
 * that the browser session already owns: the current folder, appearance, the
 * open tabs and the recent-files list.
 */
export function WorkspaceDashboard() {
  const workspace = useStore((s) => s.workspace);
  const theme = useStore((s) => s.theme);
  const recentFiles = useStore((s) => s.recentFiles);
  const tabs = useStore((s) => s.tabs);
  const openFile = useStore((s) => s.openFile);
  const clearRecentFiles = useStore((s) => s.clearRecentFiles);

  const openWorkspace = () => void useStore.getState().openWorkspace();

  const fileTabCount = useMemo(
    () => tabs.filter((t) => !t.id.startsWith("maek:virtual:")).length,
    [tabs],
  );

  const recent = useMemo(
    () => [...recentFiles].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 12),
    [recentFiles],
  );

  const toggleTheme = () => {
    useStore.setState({ theme: theme === "dark" ? "light" : "dark" });
    document.documentElement.dataset.theme = theme === "dark" ? "light" : "dark";
    schedulePersistence();
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto px-10 py-8">
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-6">
        <header className="flex items-center gap-3">
          <LayoutDashboard className="w-7 h-7 text-maek-red" strokeWidth={1.5} />
          <div>
            <h1 className="text-xl font-semibold text-neutral-ink">
              Workspace dashboard
            </h1>
            <p className="text-sm text-muted-text break-all">
              {workspace?.root ?? "No workspace open"}
            </p>
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            icon={<FileText size={16} />}
            label="Open tabs"
            value={fileTabCount}
          />
          <StatCard
            icon={<Clock size={16} />}
            label="Recent files"
            value={recentFiles.length}
          />
          <StatCard
            icon={theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
            label="Appearance"
            value={theme === "dark" ? "Dark" : "Light"}
          />
        </section>

        <section className="glass-panel rounded-xl border border-default p-5">
          <h2 className="text-sm font-semibold text-neutral-ink mb-3">
            Workspace
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={openWorkspace}>
              <FolderOpen size={16} />
              Open another folder
            </Button>
            <Button variant="ghost" onClick={toggleTheme}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              {theme === "dark" ? "Switch to light" : "Switch to dark"}
            </Button>
          </div>
        </section>

        <section className="glass-panel rounded-xl border border-default p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-neutral-ink">
              Recent files
            </h2>
            {recentFiles.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearRecentFiles}>
                <Trash2 size={14} />
                Clear
              </Button>
            )}
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-text">No recent files yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {recent.map((f) => (
                <li key={f.path}>
                  <button
                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-surface-overlay flex items-center gap-2 text-sm text-neutral-ink"
                    onClick={() => void openFile(f.path)}
                  >
                    <FileText
                      size={14}
                      className="shrink-0 text-muted-text"
                    />
                    <span className="truncate">
                      {f.path.replace(/\.md$/i, "")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="glass-panel rounded-xl border border-default p-4">
      <div className="flex items-center gap-2 text-muted-text mb-1.5">
        {icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-neutral-ink">{value}</div>
    </div>
  );
}
