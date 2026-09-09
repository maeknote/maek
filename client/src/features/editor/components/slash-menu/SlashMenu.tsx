import { forwardRef } from "react";
import { SlashMenuItem } from "./SlashMenuItem";
import type { SlashCommandItem } from "../../extensions/slash-command/slashCommandItems";

interface SlashMenuProps {
  items: SlashCommandItem[];
  selectedIndex: number;
  keyboardNav?: boolean;
  onSelect: (index: number) => void;
  onHover: (index: number) => void;
}

export const SlashMenu = forwardRef<HTMLDivElement, SlashMenuProps>(
  ({ items, selectedIndex, keyboardNav, onSelect, onHover }, ref) => {
    if (items.length === 0) return null;

    return (
      <div
        ref={ref}
        className={`maek-slash-menu ${keyboardNav ? "keyboard-nav" : ""}`}
      >
        {items.map((item, index) => (
          <SlashMenuItem
            key={item.title}
            item={item}
            isSelected={index === selectedIndex}
            onSelect={() => onSelect(index)}
            onMouseEnter={() => onHover(index)}
          />
        ))}
      </div>
    );
  },
);

SlashMenu.displayName = "SlashMenu";
