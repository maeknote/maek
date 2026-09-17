import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  SlidersHorizontal,
  FolderOpen,
  Info,
  Folder as FolderIcon,
  Check,
  Trash2,
  Monitor,
  Sun,
  Moon,
  Globe,
  Mail,
} from "lucide-react";
import { useStore, schedulePersistence } from "../../store";
import { Button } from "../../shared/components";
import { basename } from "../../lib/pathUtils";
import {
  ACCENT_COLORS,
  EDITOR_FONTS,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_MAX,
  applyPreferences,
  savePreferences,
  type Preferences,
  type ThemePreference,
} from "../../lib/preferences";

/** Web-supported keyboard shortcuts, shown read-only for reference. */
const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "⌘P / ⌘O", label: "Search & open file" },
  { keys: "⌘N", label: "New note" },
  { keys: "⌘S", label: "Save" },
  { keys: "⌘W", label: "Close tab" },
  { keys: "⌘,", label: "Settings" },
  { keys: "⌘C / ⌘V", label: "Copy / paste in tree" },
  { keys: "⌘D", label: "Duplicate in tree" },
  { keys: "⌘⌫", label: "Move to Trash" },
];

const WEB_VERSION = "1.0.0";
const LINKS = {
  website: "https://maeknote.com",
  discord: "https://discord.com/invite/Ep5mv4fTxA",
  feedback: "mailto:maeknote@gmail.com",
  repo: "https://github.com/maeknote/maek",
};

type Page = "general" | "workspace" | "about";

const NAV: { id: Page; label: string; icon: typeof Info }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "workspace", label: "Workspace", icon: FolderOpen },
  { id: "about", label: "About", icon: Info },
];

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  preferences: Preferences;
  onPreferencesChange: (prefs: Preferences) => void;
}

export function SettingsModal({
  open,
  onClose,
  preferences,
  onPreferencesChange,
}: SettingsModalProps) {
  const [page, setPage] = useState<Page>("general");
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" />
        <Dialog.Content
          className="glass-modal fixed top-[12vh] left-1/2 -translate-x-1/2 z-50 w-[min(760px,92vw)] h-[min(560px,80vh)] rounded-2xl text-neutral-ink overflow-hidden flex"
          aria-label="Settings"
        >
          <Dialog.Title className="sr-only">Settings</Dialog.Title>
          <Dialog.Description className="sr-only">
            Adjust appearance, workspace, and view details about Maek.
          </Dialog.Description>
          <nav
            aria-label="Settings sections"
            className="w-44 shrink-0 border-r border-border-gray p-3 flex flex-col gap-1 bg-warm-vellum/40"
          >
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={page === id}
                onClick={() => setPage(id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                  page === id
                    ? "bg-surface-overlay text-neutral-ink font-medium"
                    : "text-muted-text hover:bg-surface-overlay"
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
          <div className="flex-1 min-w-0 overflow-y-auto p-6">
            {page === "general" && (
              <GeneralPage
                preferences={preferences}
                onPreferencesChange={onPreferencesChange}
              />
            )}
            {page === "workspace" && <WorkspacePage onClose={onClose} />}
            {page === "about" && <AboutPage />}
          </div>
          <Dialog.Close
            aria-label="Close"
            className="icon-button absolute right-3 top-3"
          >
            <X size={16} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-text mb-3">
      {children}
    </h3>
  );
}

function GeneralPage({
  preferences,
  onPreferencesChange,
}: {
  preferences: Preferences;
  onPreferencesChange: (prefs: Preferences) => void;
}) {
  const theme = useStore((s) => s.theme);
  const setTheme = (next: ThemePreference) => {
    useStore.setState({ theme: next });
    schedulePersistence();
  };
  const update = (patch: Partial<Preferences>) =>
    onPreferencesChange({ ...preferences, ...patch });

  const themeOptions: { id: ThemePreference; label: string; icon: typeof Sun }[] =
    [
      { id: "system", label: "System", icon: Monitor },
      { id: "light", label: "Light", icon: Sun },
      { id: "dark", label: "Dark", icon: Moon },
    ];

  return (
    <div className="flex flex-col gap-7">
      <section>
        <SectionTitle>Theme</SectionTitle>
        <div className="flex gap-2" aria-label="Theme">
          {themeOptions.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={theme === id}
              aria-label={label}
              onClick={() => setTheme(id)}
              className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border text-sm transition-colors ${
                theme === id
                  ? "border-maek-red text-neutral-ink bg-surface-overlay"
                  : "border-border-gray text-muted-text hover:bg-surface-overlay"
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Accent color</SectionTitle>
        <div className="flex flex-wrap gap-3" aria-label="Accent color">
          {ACCENT_COLORS.map((accent) => (
            <button
              key={accent.id}
              type="button"
              aria-pressed={preferences.accent === accent.id}
              aria-label={accent.label}
              title={accent.label}
              onClick={() => update({ accent: accent.id })}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${
                preferences.accent === accent.id
                  ? "ring-2 ring-offset-2 ring-offset-transparent"
                  : ""
              }`}
              style={{
                backgroundColor: accent.value,
                boxShadow:
                  preferences.accent === accent.id
                    ? `0 0 0 2px ${accent.value}`
                    : undefined,
              }}
            >
              {preferences.accent === accent.id && (
                <Check size={16} className="text-white" />
              )}
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Editor font</SectionTitle>
        <select
          aria-label="Editor font"
          className="workspace-input max-w-xs"
          value={preferences.editorFont}
          onChange={(e) => update({ editorFont: e.target.value })}
        >
          {EDITOR_FONTS.map((font) => (
            <option key={font.id} value={font.id}>
              {font.label}
            </option>
          ))}
        </select>
      </section>

      <section>
        <SectionTitle>Font size</SectionTitle>
        <div className="flex items-center gap-4">
          <input
            type="range"
            aria-label="Font size"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={preferences.fontSize}
            onChange={(e) => update({ fontSize: Number(e.target.value) })}
            className="flex-1 max-w-xs"
          />
          <span className="text-sm text-muted-text w-12 tabular-nums">
            {preferences.fontSize}px
          </span>
        </div>
      </section>

      <section>
        <SectionTitle>Line height</SectionTitle>
        <div className="flex items-center gap-4">
          <input
            type="range"
            aria-label="Line height"
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step={0.1}
            value={preferences.lineHeight}
            onChange={(e) => update({ lineHeight: Number(e.target.value) })}
            className="flex-1 max-w-xs"
          />
          <span className="text-sm text-muted-text w-12 tabular-nums">
            {preferences.lineHeight.toFixed(1)}
          </span>
        </div>
      </section>

      <section>
        <SectionTitle>Keyboard shortcuts</SectionTitle>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.label}
              className="flex items-center justify-between gap-3"
            >
              <dd className="text-muted-text">{shortcut.label}</dd>
              <dt className="font-mono text-xs text-neutral-ink shrink-0">
                {shortcut.keys}
              </dt>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function WorkspacePage({ onClose }: { onClose: () => void }) {
  const workspace = useStore((s) => s.workspace);
  const workspaces = useStore((s) => s.workspaces);
  const openWorkspace = useStore((s) => s.openWorkspace);
  const removeWorkspace = useStore((s) => s.removeWorkspace);

  return (
    <div className="flex flex-col gap-7">
      <section>
        <SectionTitle>Current folder</SectionTitle>
        {workspace ? (
          <>
            <p className="text-sm font-medium text-neutral-ink">
              {workspace.name}
            </p>
            <p className="text-xs text-muted-text break-all mt-0.5">
              {workspace.root}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-text">No folder open.</p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => {
            void openWorkspace();
            onClose();
          }}
        >
          <FolderOpen size={15} /> Open folder…
        </Button>
      </section>

      <section>
        <SectionTitle>Recent workspaces</SectionTitle>
        {workspaces.length === 0 ? (
          <p className="text-sm text-muted-text">No recent workspaces.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {workspaces.map((ws) => {
              const isCurrent = ws.path === workspace?.root;
              return (
                <li
                  key={ws.path}
                  className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-overlay"
                >
                  {isCurrent ? (
                    <Check size={16} className="shrink-0 text-maek-red" />
                  ) : (
                    <FolderIcon size={16} className="shrink-0 text-muted-text" />
                  )}
                  <button
                    type="button"
                    disabled={isCurrent}
                    aria-label={`Open ${basename(ws.path) || ws.name}`}
                    onClick={() => {
                      void openWorkspace(ws.path);
                      onClose();
                    }}
                    className="flex-1 min-w-0 text-left disabled:cursor-default"
                    title={ws.path}
                  >
                    <span className="block text-sm text-neutral-ink truncate">
                      {basename(ws.path) || ws.name}
                    </span>
                    <span className="block text-xs text-muted-text truncate">
                      {ws.path}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${basename(ws.path) || ws.name} from list`}
                    title="Remove from list"
                    onClick={() => removeWorkspace(ws.path)}
                    className="icon-button opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-text mt-3">
          Removing an item clears it from this browser's list only. Your folder
          and its files are never deleted.
        </p>
      </section>
    </div>
  );
}

function DiscordLogo({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function GithubLogo({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.52 11.52 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.598 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function AboutPage() {
  const links: {
    label: string;
    href: string;
    external: boolean;
    icon: React.ReactNode;
  }[] = [
    {
      label: "Official website",
      href: LINKS.website,
      external: true,
      icon: <Globe size={18} />,
    },
    {
      label: "Discord community",
      href: LINKS.discord,
      external: true,
      icon: <DiscordLogo size={18} />,
    },
    {
      label: "GitHub repository",
      href: LINKS.repo,
      external: true,
      icon: <GithubLogo size={18} />,
    },
    {
      label: "Contact & feedback",
      href: LINKS.feedback,
      external: false,
      icon: <Mail size={18} />,
    },
  ];
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="text-lg font-semibold text-neutral-ink">Maek</h2>
        <p className="text-sm text-muted-text mt-1">
          Web version {WEB_VERSION}
        </p>
      </section>
      <section className="flex flex-col gap-1 text-sm">
        {links.map((link) => (
          <a
            key={link.label}
            className="flex items-center gap-3 px-2 py-2 rounded-lg text-neutral-ink hover:bg-surface-overlay w-fit"
            href={link.href}
            {...(link.external
              ? { target: "_blank", rel: "noreferrer noopener" }
              : {})}
          >
            <span className="text-muted-text shrink-0">{link.icon}</span>
            {link.label}
          </a>
        ))}
      </section>
      <p className="text-xs text-muted-text mt-auto pt-4 border-t border-border-gray">
        © {new Date().getFullYear()} Maek. All rights reserved.
      </p>
    </div>
  );
}

/**
 * Hook that owns preferences state, applies them to the document immediately,
 * and persists them to localStorage. Also keeps the resolved theme (light/dark)
 * on the document in sync with the store's theme preference and the OS setting.
 */
export function usePreferences(initial: Preferences) {
  const [preferences, setPreferences] = useState<Preferences>(initial);
  const onPreferencesChange = (next: Preferences) => {
    const normalized = savePreferences(next);
    setPreferences(normalized);
    applyPreferences(normalized);
  };
  useEffect(() => {
    applyPreferences(preferences);
    // Apply once on mount so a reload restores the saved look immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { preferences, onPreferencesChange };
}
