import { useEffect, useRef } from "react";
import type { SlashCommandItem } from "../../extensions/slash-command/slashCommandItems";

interface SlashMenuItemProps {
  item: SlashCommandItem;
  isSelected: boolean;
  onSelect: () => void;
  onMouseEnter: () => void;
}

export function SlashMenuItem({
  item,
  isSelected,
  onSelect,
  onMouseEnter,
}: SlashMenuItemProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const Icon = item.icon;

  useEffect(() => {
    if (isSelected && ref.current) {
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [isSelected]);

  return (
    <button
      ref={ref}
      type="button"
      className={`maek-slash-menu-item ${isSelected ? "selected" : ""} ${item.disabled ? "disabled" : ""}`}
      disabled={item.disabled}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (item.disabled) return;
        onSelect();
      }}
      onMouseEnter={onMouseEnter}
    >
      <div className="maek-slash-menu-item-icon">
        <Icon />
      </div>
      <div className="maek-slash-menu-item-text">
        <span className="maek-slash-menu-item-title">{item.title}</span>
        <span className="maek-slash-menu-item-description">
          {item.description}
        </span>
      </div>
      {item.badge && (
        <span className="maek-slash-menu-item-badge">{item.badge}</span>
      )}
      {item.shortcut && (
        <span className="maek-slash-menu-item-shortcut">{item.shortcut}</span>
      )}
    </button>
  );
}
