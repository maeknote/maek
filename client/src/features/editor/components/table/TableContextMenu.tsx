import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { FloatingMenu, MenuItem } from "@renderer/shared/components";
import type { TableMenuAction } from "../../types";

interface TableContextMenuProps {
  type: "row" | "column";
  position: { x: number; y: number };
  targetIndex: number;
  onAction: (action: TableMenuAction) => void;
  onClose: () => void;
  isHeader?: boolean;
}

interface MenuItemDef {
  label: string;
  action: TableMenuAction;
  icon: React.ReactNode;
  disabled?: boolean;
}

export function TableContextMenu({
  type,
  position,
  targetIndex: _targetIndex,
  onAction,
  onClose,
  isHeader = false,
}: TableContextMenuProps) {
  // targetIndex is passed for context but action handler uses it via parent
  void _targetIndex;

  const rowMenuItems: MenuItemDef[] = [
    {
      label: "Add Row Above",
      action: "addRowAbove",
      icon: <ArrowUp className="w-4 h-4" />,
    },
    {
      label: "Add Row Below",
      action: "addRowBelow",
      icon: <ArrowDown className="w-4 h-4" />,
    },
    {
      label: "Delete Row",
      action: "deleteRow",
      icon: <Trash2 className="w-4 h-4" />,
      disabled: isHeader,
    },
  ];

  const columnMenuItems: MenuItemDef[] = [
    {
      label: "Add Column Left",
      action: "addColumnLeft",
      icon: <ArrowLeft className="w-4 h-4" />,
    },
    {
      label: "Add Column Right",
      action: "addColumnRight",
      icon: <ArrowRight className="w-4 h-4" />,
    },
    {
      label: "Delete Column",
      action: "deleteColumn",
      icon: <Trash2 className="w-4 h-4" />,
    },
  ];

  const menuItems = type === "row" ? rowMenuItems : columnMenuItems;

  const isDeleteAction = (action: TableMenuAction) =>
    action === "deleteRow" || action === "deleteColumn";

  return (
    <FloatingMenu
      isOpen={true}
      position={position}
      onClose={onClose}
      offset={0}
    >
      {menuItems.map((item) => (
        <MenuItem
          key={item.action}
          icon={item.icon}
          label={item.label}
          disabled={item.disabled}
          destructive={isDeleteAction(item.action)}
          onClick={() => {
            onAction(item.action);
            onClose();
          }}
        />
      ))}
    </FloatingMenu>
  );
}
