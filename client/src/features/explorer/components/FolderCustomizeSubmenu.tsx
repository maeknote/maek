import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useFolderAppearance } from "../stores/folderAppearanceStore";
import {
  FOLDER_ICON_SECTIONS,
  FOLDER_ICON_COLOR_OPTIONS,
  getFolderIconColorValue,
} from "../utils/folderAppearance";

export function FolderCustomizeSubmenu({
  folderPath,
  isOpen,
  onClose,
}: {
  folderPath: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { appearances, setAppearance } = useFolderAppearance();
  const current = appearances[folderPath] ?? null;
  const [selectedColor, setSelectedColor] = useState<string>(
    current?.iconColor ?? "accent",
  );

  const handleSelect = (iconId: string) => {
    setAppearance(folderPath, { icon: iconId, iconColor: selectedColor });
    onClose();
  };

  const handleColorChange = (colorId: string) => {
    setSelectedColor(colorId);
    if (current) {
      setAppearance(folderPath, { icon: current.icon, iconColor: colorId });
    }
  };

  const handleReset = () => {
    setAppearance(folderPath, null);
    onClose();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" />
        <Dialog.Content className="fixed top-[12vh] left-1/2 -translate-x-1/2 z-50 shadow-2xl rounded-2xl overflow-hidden bg-surface border border-default w-[340px] max-h-[70vh] flex flex-col">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <Dialog.Title className="text-sm font-medium text-primary">
              Folder Icon
            </Dialog.Title>
            <div className="flex items-center gap-2">
              {current && (
                <button
                  onClick={handleReset}
                  className="text-xs text-muted-text hover:text-primary transition-colors"
                >
                  Reset
                </button>
              )}
              <Dialog.Close asChild>
                <button className="text-muted-text hover:text-primary transition-colors">
                  <X size={14} />
                </button>
              </Dialog.Close>
            </div>
          </div>

          {/* Color selector */}
          <div className="flex items-center gap-1.5 px-4 pb-2">
            {FOLDER_ICON_COLOR_OPTIONS.map((color) => (
              <button
                key={color.id}
                onClick={() => handleColorChange(color.id)}
                className="w-5 h-5 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: getFolderIconColorValue(color.id),
                  borderColor:
                    selectedColor === color.id
                      ? getFolderIconColorValue(color.id)
                      : "transparent",
                  outline:
                    selectedColor === color.id
                      ? `2px solid ${getFolderIconColorValue(color.id)}`
                      : "none",
                  outlineOffset: "1px",
                }}
                title={color.label}
              />
            ))}
          </div>

          {/* Icon grid */}
          <div className="overflow-y-auto px-3 pb-3 flex-1">
            {FOLDER_ICON_SECTIONS.map((section) => (
              <div key={section.title} className="mb-2">
                <div className="text-[10px] font-medium text-muted-text uppercase tracking-wider px-1 mb-1">
                  {section.title}
                </div>
                <div className="grid grid-cols-8 gap-0.5">
                  {section.icons.map((preset) => {
                    const Icon = preset.icon;
                    const isSelected = current?.icon === preset.id;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => handleSelect(preset.id)}
                        className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                          isSelected
                            ? "bg-maek-red/15 ring-1 ring-maek-red/40"
                            : "hover:bg-hover"
                        }`}
                        title={preset.label}
                      >
                        <Icon
                          size={18}
                          style={{
                            color: getFolderIconColorValue(selectedColor),
                          }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
