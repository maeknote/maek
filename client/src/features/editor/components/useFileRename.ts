import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { getDisplayName, toFileName } from "../utils/displayName";

export interface FileRenameProps {
  /** Current on-disk file name including extension. */
  fileName: string;
  /** Persist the new full file name (including extension). */
  onRename: (newFileName: string) => Promise<void>;
}

export interface FileRename {
  /** Current editable value (extension stripped). */
  value: string;
  /** True while the rename request is in flight. */
  isSubmitting: boolean;
  /** Ref to attach to the input element. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Controlled input change handler. */
  onChange: (value: string) => void;
  /** Commit on blur. */
  onBlur: () => void;
  /** Enter commits, Escape reverts. */
  onKeyDown: (e: KeyboardEvent) => void;
}

/**
 * Shared rename behaviour for file titles. Preserves the original extension,
 * reverts empty or unchanged input to the display name, and disables editing
 * while a rename is being persisted.
 */
export function useFileRename({ fileName, onRename }: FileRenameProps): FileRename {
  const displayName = getDisplayName(fileName);
  const [value, setValue] = useState(displayName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape blurs the input to exit editing, but that blur must not commit the
  // discarded value. This flag tells the blur handler to skip one commit.
  const skipNextCommit = useRef(false);

  // Sync when the underlying file changes (tab switch, external rename).
  useEffect(() => {
    setValue(getDisplayName(fileName));
  }, [fileName]);

  const handleSubmit = useCallback(async () => {
    if (skipNextCommit.current) {
      skipNextCommit.current = false;
      setValue(displayName);
      return;
    }
    const trimmed = value.trim();

    // Empty or unchanged → revert to the current display name.
    if (!trimmed || trimmed === displayName) {
      setValue(displayName);
      return;
    }

    const newFileName = toFileName(trimmed, fileName);
    setIsSubmitting(true);
    try {
      await onRename(newFileName);
    } catch {
      // Revert on failure.
      setValue(displayName);
    } finally {
      setIsSubmitting(false);
    }
  }, [value, displayName, fileName, onRename]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        inputRef.current?.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        skipNextCommit.current = true;
        setValue(displayName);
        inputRef.current?.blur();
      }
    },
    [displayName],
  );

  return {
    value,
    isSubmitting,
    inputRef,
    onChange: setValue,
    onBlur: handleSubmit,
    onKeyDown,
  };
}
