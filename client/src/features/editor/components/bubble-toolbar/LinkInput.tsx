import { useState, useRef, useEffect } from "react";
import { Check, X } from "lucide-react";
import type { Editor } from "@tiptap/react";

export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^(https?:\/\/|mailto:|tel:|#)/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

interface LinkInputProps {
  editor: Editor;
  onClose: () => void;
}

export function LinkInput({ editor, onClose }: LinkInputProps) {
  const [url, setUrl] = useState(editor.getAttributes("link").href ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSubmit = () => {
    const normalized = normalizeUrl(url);
    if (normalized) {
      editor.chain().focus().setLink({ href: normalized }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    onClose();
  };

  const handleRemove = () => {
    editor.chain().focus().unsetLink().run();
    onClose();
  };

  return (
    <div className="maek-link-input">
      <input
        ref={inputRef}
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Enter URL..."
        spellCheck={false}
      />
      <button
        className="maek-link-input-btn confirm"
        onClick={handleSubmit}
        aria-label="Confirm"
      >
        <Check />
      </button>
      {editor.isActive("link") && (
        <button
          className="maek-link-input-btn remove"
          onClick={handleRemove}
          aria-label="Remove link"
        >
          <X />
        </button>
      )}
    </div>
  );
}
