import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, Check, ChevronRight, Palette, RotateCcw } from "lucide-react";
import { Button } from "../../../shared/components";
import { cn } from "../../../lib/utils";
import { useFolderAppearance } from "../stores/folderAppearanceStore";
import {
  FOLDER_ICON_COLOR_OPTIONS,
  FOLDER_ICON_MAP,
  FOLDER_ICON_PRESETS,
  getFolderIconColorValue,
} from "../utils/folderAppearance";

const SUBMENU_WIDTH = 380;
const VIEWPORT_PADDING = 24;
const COLOR_MENU_WIDTH = 180;

export function FolderCustomizeSubmenu({
  folderPath,
  folderName,
  onClose,
}: {
  folderPath: string;
  folderName: string;
  onClose: () => void;
}) {
  const { appearances, setAppearance } = useFolderAppearance();
  const appearance = appearances[folderPath] ?? null;

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(appearance?.icon ?? null);
  const [selectedColor, setSelectedColor] = useState<string>(
    appearance?.iconColor ?? "accent"
  );
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);
  const [colorMenuPosition, setColorMenuPosition] = useState<{ x: number; y: number } | null>(null);
  
  const triggerRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement | null>(null);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const colorMenuRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const PreviewIcon = useMemo(
    () => (selectedIcon ? FOLDER_ICON_MAP[selectedIcon as any] ?? Ban : Ban),
    [selectedIcon]
  );
  
  const selectedColorOption = useMemo(
    () =>
      FOLDER_ICON_COLOR_OPTIONS.find((option) => option.id === selectedColor) ??
      FOLDER_ICON_COLOR_OPTIONS[0]!,
    [selectedColor]
  );

  const clearTimer = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const closePanel = useCallback((): void => {
    clearTimer();
    setIsColorMenuOpen(false);
    setColorMenuPosition(null);
    setIsOpen(false);
    setPosition(null);
    onClose();
  }, [clearTimer, onClose]);

  const scheduleClose = useCallback((): void => {
    clearTimer();
    timerRef.current = setTimeout(closePanel, 160);
  }, [clearTimer, closePanel]);

  const openFromTrigger = useCallback((): void => {
    clearTimer();
    if (isOpen) return;
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const preferredRight = rect.right;
    const x =
      preferredRight + SUBMENU_WIDTH > window.innerWidth - VIEWPORT_PADDING
        ? Math.max(VIEWPORT_PADDING, rect.left - SUBMENU_WIDTH)
        : preferredRight;
    const y = Math.max(VIEWPORT_PADDING, rect.top);
    setPosition({ x, y });
    setIsOpen(true);
  }, [clearTimer, isOpen]);

  const adjustPosition = useCallback((): void => {
    if (!isOpen || !portalRef.current || !triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const panelRect = portalRef.current.getBoundingClientRect();
    const rightX = triggerRect.right;
    const leftX = triggerRect.left - panelRect.width;

    let x =
      rightX + panelRect.width > window.innerWidth - VIEWPORT_PADDING
        ? Math.max(VIEWPORT_PADDING, leftX)
        : rightX;
    if (x + panelRect.width > window.innerWidth - VIEWPORT_PADDING) {
      x = Math.max(VIEWPORT_PADDING, window.innerWidth - panelRect.width - VIEWPORT_PADDING);
    }

    let y = triggerRect.top;
    if (y + panelRect.height > window.innerHeight - VIEWPORT_PADDING) {
      y = Math.max(VIEWPORT_PADDING, window.innerHeight - panelRect.height - VIEWPORT_PADDING);
    }
    if (y < VIEWPORT_PADDING) y = VIEWPORT_PADDING;

    setPosition((current) => {
      if (current && Math.abs(current.x - x) < 0.5 && Math.abs(current.y - y) < 0.5) {
        return current;
      }
      return { x, y };
    });
  }, [isOpen]);

  useLayoutEffect(() => {
    adjustPosition();
  }, [isOpen, adjustPosition]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("resize", adjustPosition);
    return () => window.removeEventListener("resize", adjustPosition);
  }, [isOpen, adjustPosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalMouseMove = (e: MouseEvent): void => {
      if (!portalRef.current || !triggerRef.current) return;
      const isOverPanel = portalRef.current.contains(e.target as Node);
      const isOverTrigger = triggerRef.current.contains(e.target as Node);
      const isOverColorMenu = colorMenuRef.current?.contains(e.target as Node);

      if (isOverPanel || isOverTrigger || isOverColorMenu) {
        clearTimer();
      } else if (!timerRef.current && !isColorMenuOpen) {
        scheduleClose();
      }
    };
    document.addEventListener("mousemove", handleGlobalMouseMove);
    return () => document.removeEventListener("mousemove", handleGlobalMouseMove);
  }, [isOpen, clearTimer, scheduleClose, isColorMenuOpen]);

  const openColorMenu = useCallback(() => {
    if (!colorButtonRef.current) return;
    const rect = colorButtonRef.current.getBoundingClientRect();
    setIsColorMenuOpen(true);
    let x = rect.left;
    if (x + COLOR_MENU_WIDTH > window.innerWidth - VIEWPORT_PADDING) {
      x = Math.max(VIEWPORT_PADDING, window.innerWidth - COLOR_MENU_WIDTH - VIEWPORT_PADDING);
    }
    setColorMenuPosition({ x, y: rect.bottom + 4 });
  }, []);

  const handleSave = () => {
    if (selectedIcon) {
      setAppearance(folderPath, { icon: selectedIcon, iconColor: selectedColor });
    } else {
      setAppearance(folderPath, null);
    }
    closePanel();
  };

  const handleReset = () => {
    setAppearance(folderPath, null);
    closePanel();
  };

  return (
    <div className="contents">
      <button
        type="button"
        ref={triggerRef}
        className="menu-item"
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) closePanel();
          else openFromTrigger();
        }}
      >
        <span className="menu-item-label flex-1">Change icon</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-text" />
      </button>

      {isOpen && position
        ? createPortal(
            <div
              ref={portalRef}
              className="fixed z-50 glass-surface menu-container p-0 flex flex-col animate-menu-in"
              style={{
                left: position.x,
                top: position.y,
                width: SUBMENU_WIDTH,
              }}
              onMouseEnter={clearTimer}
              onMouseLeave={() => !isColorMenuOpen && scheduleClose()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              role="menu"
            >
              <div className="flex shrink-0 items-center gap-3 border-b border-[var(--glass-border)] bg-[var(--color-overlay-bg)] px-3 py-2">
                <Palette className="h-4 w-4 text-maek-red shrink-0" />
                <p className="mt-0.5 truncate text-xs text-muted-text">{folderName}</p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                <div className="mb-3 flex items-center gap-2 px-0.5 py-1">
                  {selectedIcon ? (
                    <div
                      className="flex h-6 w-6 items-center justify-center"
                      style={{ color: getFolderIconColorValue(selectedColor as any) }}
                    >
                      <PreviewIcon className="h-4 w-4" />
                    </div>
                  ) : null}
                  <div className="min-w-0">
                    <p className="truncate text-sm text-neutral-ink">{folderName}</p>
                  </div>
                </div>

                <section className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wider text-muted-text">Icon</h3>
                  <div className="max-h-[176px] overflow-y-auto pr-1">
                    <div className="grid grid-cols-8 gap-1">
                      <button
                        type="button"
                        aria-label="No Icon"
                        data-hover-hint="No Icon"
                        onClick={() => setSelectedIcon(null)}
                        className={cn(
                          "relative flex h-8 items-center justify-center rounded-md border border-transparent bg-transparent transition-colors",
                          selectedIcon === null
                            ? "text-maek-red"
                            : "text-muted-text hover:text-neutral-ink"
                        )}
                      >
                        <Ban className="h-3.5 w-3.5" />
                        {selectedIcon === null ? (
                          <span className="absolute right-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-maek-red text-white">
                            <Check className="h-2 w-2" />
                          </span>
                        ) : null}
                      </button>
                      {FOLDER_ICON_PRESETS.map((preset) => {
                        const Icon = preset.icon;
                        const selected = selectedIcon === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            aria-label={preset.label}
                            data-hover-hint={preset.label}
                            onClick={() => setSelectedIcon(preset.id)}
                            className={cn(
                              "relative flex h-8 items-center justify-center rounded-md border border-transparent bg-transparent transition-colors",
                              selected ? "text-maek-red" : "text-muted-text hover:text-neutral-ink"
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {selected ? (
                              <span className="absolute right-0.5 top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-maek-red text-white">
                                <Check className="h-2 w-2" />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className="mt-3 space-y-2">
                  <h3 className="text-xs uppercase tracking-wider text-muted-text">Color</h3>
                  <button
                    ref={colorButtonRef}
                    type="button"
                    onClick={() => {
                      if (isColorMenuOpen) {
                        setIsColorMenuOpen(false);
                        setColorMenuPosition(null);
                      } else {
                        openColorMenu();
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-input-bg)] px-2.5 py-2 text-left text-xs text-neutral-ink transition-colors hover:bg-[var(--color-overlay-bg)]"
                  >
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--color-input-border)]"
                      style={{ backgroundColor: selectedColorOption.value }}
                    />
                    <span className="min-w-0 flex-1 truncate">{selectedColorOption.label}</span>
                    <ChevronRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-text transition-transform",
                        isColorMenuOpen && "rotate-90"
                      )}
                    />
                  </button>
                </section>
              </div>

              <div className="flex items-center justify-between border-t border-[var(--glass-border)] px-3 pb-3 pt-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleReset()}
                  disabled={!appearance}
                  className="h-8 text-muted-text"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </Button>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={closePanel}
                    className="h-8 bg-transparent"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSave()}
                    className="h-8"
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {isColorMenuOpen && colorMenuPosition
        ? createPortal(
            <div
              ref={colorMenuRef}
              className="fixed z-[60] glass-surface menu-container animate-menu-in p-1"
              style={{
                left: colorMenuPosition.x,
                top: colorMenuPosition.y,
                width: COLOR_MENU_WIDTH,
              }}
              onMouseDown={(event) => event.stopPropagation()}
              role="menu"
            >
              {FOLDER_ICON_COLOR_OPTIONS.map((option) => {
                const selected = selectedColor === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setSelectedColor(option.id);
                      setIsColorMenuOpen(false);
                      setColorMenuPosition(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      selected
                        ? "bg-maek-red/10 text-neutral-ink"
                        : "text-muted-text hover:bg-[var(--color-overlay-bg)] hover:text-neutral-ink"
                    )}
                  >
                    <span
                      className="h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--color-input-border)]"
                      style={{ backgroundColor: option.value }}
                    />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {selected ? <Check className="h-3.5 w-3.5 text-maek-red" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
