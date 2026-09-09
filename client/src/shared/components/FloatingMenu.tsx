/**
 * FloatingMenu Component
 *
 * A reusable floating menu with Liquid Glass styling, portal rendering,
 * and automatic viewport boundary adjustment.
 *
 * Consolidates shared patterns from:
 * - NewNoteMenu, ExplorerContextMenu, ModelMenu, HistoryPopover, TableContextMenu
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@renderer/lib/utils";
import { useDismissible } from "../hooks";

export interface FloatingMenuPosition {
  x: number;
  y: number;
}

export interface FloatingMenuProps {
  /** Whether the menu is visible */
  isOpen: boolean;
  /** Position coordinates (x, y) or anchor element ref */
  position: FloatingMenuPosition | null;
  /** Callback when menu should close */
  onClose: () => void;
  /** Menu content */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Anchor element ref (excluded from outside click detection) */
  anchorRef?: RefObject<HTMLElement | null>;
  /**
   * Extra refs that should also be excluded from outside-click detection.
   * Useful for sibling popovers (e.g., a submenu rendered as a separate portal)
   * so clicks inside them don't dismiss this menu.
   */
  extraDismissRefs?: Array<RefObject<HTMLElement | null>>;
  /** Minimum width (default: 180px) */
  minWidth?: number;
  /** Offset from position (default: 4px) */
  offset?: number;
  /** Preferred placement direction */
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
}

/**
 * FloatingMenu - Portal-based menu with Liquid Glass styling
 *
 * @example
 * ```tsx
 * <FloatingMenu
 *   isOpen={isMenuOpen}
 *   position={{ x: rect.left, y: rect.bottom }}
 *   onClose={() => setIsMenuOpen(false)}
 *   anchorRef={buttonRef}
 * >
 *   <MenuItem onClick={handleAction} icon={<Icon />} label="Action" />
 * </FloatingMenu>
 * ```
 */
export function FloatingMenu({
  isOpen,
  position,
  onClose,
  children,
  className,
  anchorRef,
  extraDismissRefs,
  minWidth = 180,
  offset = 4,
  // placement is reserved for future enhancement
}: FloatingMenuProps): ReactElement | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] =
    useState<FloatingMenuPosition | null>(null);
  const [isPositioned, setIsPositioned] = useState(false);

  // Build refs array for dismissible hook. The refs themselves are only ever
  // read inside the hook's event handlers (`mousedown`), never during render.
  const refs = useMemo(() => {
    const list: Array<RefObject<HTMLElement | null>> = [menuRef];
    if (anchorRef) list.push(anchorRef);
    if (extraDismissRefs) list.push(...extraDismissRefs);
    return list;
  }, [anchorRef, extraDismissRefs]);

  useDismissible({
    isOpen,
    onClose,
    refs,
  });

  // Phase 1: Set initial position when menu opens or position changes
  useLayoutEffect(() => {
    if (!isOpen || !position) {
      setAdjustedPosition(null);
      setIsPositioned(false);
      return;
    }
    setIsPositioned(false);
    setAdjustedPosition(position);
  }, [isOpen, position]);

  // Phase 2: Measure DOM and adjust position to stay within viewport
  useLayoutEffect(() => {
    if (!isOpen || isPositioned || !menuRef.current) return;

    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 8;

    let x = adjustedPosition?.x ?? 0;
    let y = (adjustedPosition?.y ?? 0) + offset;

    // Handle horizontal overflow
    if (x + rect.width > vw - pad) {
      x = Math.max(pad, x - rect.width);
    }
    if (x < pad) {
      x = pad;
    }

    // Handle vertical overflow
    if (y + rect.height > vh - pad) {
      y = Math.max(pad, (adjustedPosition?.y ?? 0) - rect.height - offset);
    }

    setAdjustedPosition({ x, y });
    setIsPositioned(true);
  }, [isOpen, isPositioned, offset, adjustedPosition]);

  // Recalculate on window resize
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = (): void => {
      setIsPositioned(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen]);

  if (!isOpen || !adjustedPosition) return null;

  const menu = (
    <div
      ref={menuRef}
      className={cn(
        // Base positioning
        "fixed z-50",
        // Glass styling from effects.css
        "glass-surface",
        // Menu container from effects.css
        "menu-container",
        // Animation (only after positioning is complete)
        isPositioned && "animate-menu-in",
        className,
      )}
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        minWidth,
        visibility: isPositioned ? "visible" : "hidden",
      }}
      role="menu"
    >
      {children}
    </div>
  );

  return createPortal(menu, document.body);
}
