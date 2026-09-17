import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ActiveTooltip = {
  anchor: HTMLButtonElement;
  label: string;
};

function getTooltipTarget(target: EventTarget | null): ActiveTooltip | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("button");
  if (!(anchor instanceof HTMLButtonElement) || anchor.disabled) return null;

  const explicitLabel = anchor.dataset.hoverHint;
  if (explicitLabel) return { anchor, label: explicitLabel };
  if (anchor.dataset.tooltip) return null;

  const label = anchor.getAttribute("aria-label");
  const iconOnly =
    anchor.children.length > 0 &&
    [...anchor.children].every(
      (child) => child instanceof SVGSVGElement,
    );
  return label && iconOnly ? { anchor, label } : null;
}

/**
 * One portal-based hint layer for icon-only actions. Unlike CSS pseudo-element
 * tooltips, it is never clipped by a panel and Floating UI keeps it onscreen.
 */
export function GlobalTooltip() {
  const [active, setActive] = useState<ActiveTooltip | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const show = (target: EventTarget | null) => {
      const next = getTooltipTarget(target);
      if (next) setActive(next);
    };
    const hideIfLeaving = (event: PointerEvent) => {
      const current = getTooltipTarget(event.target);
      if (current && !current.anchor.contains(event.relatedTarget as Node | null)) {
        setActive((open) => (open?.anchor === current.anchor ? null : open));
      }
    };
    const hideIfBlurring = (event: FocusEvent) => {
      const current = getTooltipTarget(event.target);
      if (current && !current.anchor.contains(event.relatedTarget as Node | null)) {
        setActive((open) => (open?.anchor === current.anchor ? null : open));
      }
    };

    const showOnPointerOver = (event: PointerEvent) => show(event.target);
    const showOnFocus = (event: FocusEvent) => show(event.target);
    document.addEventListener("pointerover", showOnPointerOver);
    document.addEventListener("pointerout", hideIfLeaving);
    document.addEventListener("focusin", showOnFocus);
    document.addEventListener("focusout", hideIfBlurring);
    return () => {
      document.removeEventListener("pointerover", showOnPointerOver);
      document.removeEventListener("pointerout", hideIfLeaving);
      document.removeEventListener("focusin", showOnFocus);
      document.removeEventListener("focusout", hideIfBlurring);
    };
  }, []);

  useEffect(() => {
    const floating = tooltipRef.current;
    if (!active || !floating) return;
    return autoUpdate(active.anchor, floating, () => {
      void computePosition(active.anchor, floating, {
        strategy: "fixed",
        placement: "top",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
      }).then(({ x, y }) => setPosition({ x, y }));
    });
  }, [active]);

  if (!active) return null;
  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className="pointer-events-none fixed z-[1200] rounded bg-[var(--color-tooltip-bg)] px-2 py-[3px] text-[11px] font-[450] leading-[1.3] text-[var(--color-tooltip-text)] whitespace-nowrap"
      style={{ left: position.x, top: position.y }}
    >
      {active.label}
    </div>,
    document.body,
  );
}
