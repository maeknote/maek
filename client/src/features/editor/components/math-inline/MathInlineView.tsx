import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMathPreview } from "../../utils/mathPreview";

export function MathInlineView({
  node,
  updateAttributes,
  editor,
}: NodeViewProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : "";
  const startInEditMode = node.attrs.startInEditMode === true;
  const preview = useMemo(() => renderMathPreview(latex), [latex]);

  useEffect(() => {
    if (!startInEditMode) return;
    setIsEditing(true);
    updateAttributes({ startInEditMode: false });
  }, [startInEditMode, updateAttributes]);

  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  const handleEnterEditMode = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleExitEditMode = useCallback(() => {
    setIsEditing(false);
    editor.commands.focus();
  }, [editor]);

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      handleExitEditMode();
    },
    [handleExitEditMode],
  );

  return (
    <NodeViewWrapper
      as="span"
      className={`tiptap-math-inline ${isEditing ? "is-editing" : "is-preview-only"}`}
    >
      <span
        className="math-inline-shell"
        contentEditable={false}
        onDoubleClick={isEditing ? undefined : handleEnterEditMode}
      >
        {isEditing ? (
          <span className="math-inline-editor">
            <input
              ref={inputRef}
              className="math-inline-input"
              value={latex}
              placeholder="Type LaTeX..."
              spellCheck={false}
              onChange={(event) =>
                updateAttributes({ latex: event.target.value })
              }
              onKeyDown={handleInputKeyDown}
            />
            <button
              type="button"
              className="math-inline-done"
              onClick={handleExitEditMode}
              aria-label="Done editing inline math"
              data-tooltip="Done"
            >
              <Check className="w-3 h-3" />
            </button>
          </span>
        ) : preview.error ? (
          <span
            className="math-inline-error"
            data-tooltip="Double-click to edit"
          >
            Invalid math
          </span>
        ) : preview.html ? (
          <span
            className="math-inline-preview"
            data-tooltip="Double-click to edit"
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        ) : (
          <span
            className="math-inline-placeholder"
            data-tooltip="Double-click to edit"
          >
            Empty math
          </span>
        )}
      </span>
    </NodeViewWrapper>
  );
}
