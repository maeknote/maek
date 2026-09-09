import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check, Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMathPreview } from "../../utils/mathPreview";

export function MathBlockView({
  node,
  updateAttributes,
  selected,
  editor,
}: NodeViewProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const latex = typeof node.attrs.latex === "string" ? node.attrs.latex : "";
  const startInEditMode = node.attrs.startInEditMode === true;

  const preview = useMemo(
    () => renderMathPreview(latex, { displayMode: true }),
    [latex],
  );

  useEffect(() => {
    if (!startInEditMode) return;
    setIsEditing(true);
    updateAttributes({ startInEditMode: false });
  }, [startInEditMode, updateAttributes]);

  useEffect(() => {
    if (!isEditing) return;
    textareaRef.current?.focus();
  }, [isEditing]);

  const handleEnterEditMode = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleExitEditMode = useCallback(() => {
    setIsEditing(false);
    editor.commands.focus();
  }, [editor]);

  const handleSourceKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      handleExitEditMode();
    },
    [handleExitEditMode],
  );

  return (
    <NodeViewWrapper
      className={`tiptap-math-block ${selected ? "is-selected" : ""} ${isEditing ? "is-editing" : "is-preview-only"}`}
    >
      <div
        className="math-block-shell"
        contentEditable={false}
        onDoubleClick={isEditing ? undefined : handleEnterEditMode}
      >
        <button
          type="button"
          className="math-block-toggle"
          onClick={isEditing ? handleExitEditMode : handleEnterEditMode}
          aria-label={isEditing ? "Done editing math block" : "Edit math block"}
          data-tooltip={isEditing ? "Done" : "Edit"}
        >
          {isEditing ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Pencil className="w-3.5 h-3.5" />
          )}
        </button>

        {isEditing && (
          <textarea
            ref={textareaRef}
            className="math-block-source"
            value={latex}
            placeholder="Type LaTeX..."
            spellCheck={false}
            onChange={(event) =>
              updateAttributes({ latex: event.target.value })
            }
            onKeyDown={handleSourceKeyDown}
          />
        )}

        <div className="math-block-preview-shell">
          {preview.error ? (
            <div className="math-block-error">
              <div className="math-block-error-title">KaTeX render error</div>
              <div className="math-block-error-message">{preview.error}</div>
            </div>
          ) : preview.html ? (
            <div
              className="math-block-preview"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          ) : (
            <div className="math-block-placeholder">Preview appears here.</div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
