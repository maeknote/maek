/**
 * useDismissible Hook
 *
 * Handles click-outside and Escape key dismissal for floating UI elements.
 * Consolidates duplicated logic from NewNoteMenu, ExplorerContextMenu, etc.
 */

import { useEffect, type RefObject } from "react";

interface UseDismissibleOptions {
  /** Whether the dismissible element is currently open */
  isOpen: boolean;
  /** Callback when the element should be dismissed */
  onClose: () => void;
  /** Optional distinct Escape action when outside clicks should commit. */
  onEscape?: () => void;
  /** Refs to elements that should NOT trigger dismiss when clicked */
  refs: RefObject<HTMLElement | null>[];
  /** Whether to listen for Escape key (default: true) */
  escapeKey?: boolean;
  /** Whether to listen for outside clicks (default: true) */
  outsideClick?: boolean;
}

/**
 * Hook to handle dismissing floating UI elements (menus, popovers, modals)
 *
 * @example
 * ```tsx
 * const menuRef = useRef<HTMLDivElement>(null)
 *
 * useDismissible({
 *   isOpen,
 *   onClose,
 *   refs: [menuRef, anchorRef],
 * })
 * ```
 */
export function useDismissible({
  isOpen,
  onClose,
  onEscape,
  refs,
  escapeKey = true,
  outsideClick = true,
}: UseDismissibleOptions): void {
  // Handle outside click
  useEffect(() => {
    if (!isOpen || !outsideClick) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Check if click is inside any of the provided refs
      const isInside = refs.some((ref) => ref.current?.contains(target));
      if (!isInside) {
        onClose();
      }
    };

    const iframeListeners = new Map<HTMLIFrameElement, () => void>();
    const listenToIframe = (iframe: HTMLIFrameElement) => {
      if (iframeListeners.has(iframe)) return;

      const handleIframeMouseDown = () => onClose();
      const attach = () => {
        try {
          iframe.contentDocument?.addEventListener("mousedown", handleIframeMouseDown);
        } catch {
          // Cross-origin frames cannot be inspected; their clicks are isolated
          // by the browser and cannot participate in outside-click detection.
        }
      };
      const handleLoad = () => attach();

      attach();
      iframe.addEventListener("load", handleLoad);
      iframeListeners.set(iframe, () => {
        iframe.removeEventListener("load", handleLoad);
        try {
          iframe.contentDocument?.removeEventListener("mousedown", handleIframeMouseDown);
        } catch {
          // Ignore inaccessible cross-origin documents during cleanup.
        }
      });
    };

    const listenToIframes = () => {
      document.querySelectorAll("iframe").forEach((iframe) => listenToIframe(iframe));
    };

    document.addEventListener("mousedown", handleMouseDown);
    listenToIframes();
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      iframeListeners.forEach((cleanup) => cleanup());
    };
  }, [isOpen, onClose, onEscape, refs, outsideClick]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen || !escapeKey) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        (onEscape ?? onClose)();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onEscape, escapeKey]);
}
