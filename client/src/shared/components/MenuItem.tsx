/**
 * MenuItem Component
 *
 * A reusable menu item for use inside FloatingMenu.
 * Supports icons, labels, descriptions, shortcuts, and various states.
 *
 * Consolidates shared patterns from:
 * - SlashMenuItem, ExplorerContextMenu items, ModelMenu items, TableContextMenu items
 */

import { forwardRef, type ReactNode, type ButtonHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";

export interface MenuItemProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  /** Icon element (left side) */
  icon?: ReactNode;
  /** Primary label text */
  label: string;
  /** Secondary description (below label, for slash menu style) */
  description?: string;
  /** Keyboard shortcut display (right side) */
  shortcut?: string;
  /** Whether this is a destructive action (red text) */
  destructive?: boolean;
  /** Whether this item is currently selected */
  selected?: boolean;
  /** Custom style for label (e.g., font-family preview) */
  labelStyle?: React.CSSProperties;
}

/**
 * MenuItem - Button for use inside FloatingMenu
 *
 * @example
 * ```tsx
 * <MenuItem
 *   icon={<Copy className="w-4 h-4" />}
 *   label="Copy"
 *   shortcut="⌘C"
 *   onClick={handleCopy}
 * />
 * ```
 */
export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  (
    {
      icon,
      label,
      description,
      shortcut,
      destructive = false,
      selected = false,
      disabled = false,
      className,
      onClick,
      labelStyle,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "menu-item",
          destructive && "destructive",
          selected && "selected",
          disabled && "disabled",
          className,
        )}
        {...props}
      >
        {icon && <span className="menu-item-icon">{icon}</span>}

        {description ? (
          // Slash menu style: title + description stacked
          <div className="flex flex-col items-start flex-1 min-w-0">
            <span className="menu-item-label truncate" style={labelStyle}>
              {label}
            </span>
            <span className="text-[11px] text-muted-text opacity-70 truncate">
              {description}
            </span>
          </div>
        ) : (
          // Standard style: just label
          <span className="menu-item-label flex-1" style={labelStyle}>
            {label}
          </span>
        )}

        {shortcut && <span className="menu-item-shortcut">{shortcut}</span>}
      </button>
    );
  },
);

MenuItem.displayName = "MenuItem";

/**
 * MenuSeparator - Visual divider between menu items
 */
export function MenuSeparator() {
  return <div className="menu-separator" role="separator" />;
}
