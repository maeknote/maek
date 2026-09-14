import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import * as Dialog from "@radix-ui/react-dialog";
import { useFolderAppearance } from "../stores/folderAppearanceStore";
import { useStore } from "../../../store";

export function FolderCustomizeSubmenu({ folderPath, isOpen, onClose }: { folderPath: string; isOpen: boolean; onClose: () => void }) {
  const { setAppearance } = useFolderAppearance();
  const theme = useStore((s) => s.theme);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" />
        <Dialog.Content className="glass-modal fixed top-[18vh] left-1/2 -translate-x-1/2 z-50 shadow-2xl rounded-2xl overflow-hidden bg-surface">
          <Dialog.Title className="sr-only">Choose Folder Icon</Dialog.Title>
          <Picker
            data={data}
            onEmojiSelect={(emoji: { native: string }) => {
              setAppearance(folderPath, emoji.native);
              onClose();
            }}
            theme={theme}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
