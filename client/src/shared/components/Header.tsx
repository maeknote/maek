import { cn } from "@renderer/lib/utils";
import type { PropsWithChildren } from "react";

interface HeaderProps extends PropsWithChildren {
  className?: string;
}

/**
 * Shared header bar
 * - Fixed height: h-12 (48px)
 * - Drag region: titlebar-drag-region
 */
export function Header({ children, className }: HeaderProps) {
  return (
    <div
      className={cn(
        "titlebar-drag-region h-12 px-4 flex items-center justify-between",
        "border-b border-structure-line",
        className,
      )}
    >
      <div className="no-drag flex w-full items-center justify-between gap-3 text-neutral-ink">
        {children}
      </div>
    </div>
  );
}
