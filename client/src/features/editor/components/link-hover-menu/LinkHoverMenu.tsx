import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import {
  Pencil,
  Unlink,
  Check,
  X,
  Copy,
  ExternalLink,
  FileText,
  Table,
} from "lucide-react";
import { computePosition, offset, flip, shift } from "@floating-ui/dom";
import type { Editor } from "@tiptap/react";
import { normalizeUrl } from "../bubble-toolbar/LinkInput";
import {
  dirname,
  normalizeWorkspaceHref,
  resolvePath,
  workspaceHref,
} from "@renderer/lib/pathUtils";
import { useNotePickerStore } from "../../stores/notePickerStore";
import { getDisplayName } from "../../utils/displayName";
import {
  getWorkspaceTargetDisplayName,
  getWorkspaceTargetIsDatabase,
  openWorkspaceTargetHref,
} from "../../utils/openWorkspaceTarget";
import type { FileNode } from "@shared/types";

interface LinkHoverMenuProps {
  editor: Editor;
  notePath: string;
}

interface LinkData {
  href: string;
  text: string;
  element: HTMLAnchorElement;
  isNoteLink: boolean;
}

export function LinkHoverMenu({
  editor,
  notePath,
}: LinkHoverMenuProps): ReactElement | null {
  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editUrl, setEditUrl] = useState("");
  const [editText, setEditText] = useState("");
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimers();
    setLinkData(null);
    setIsEditing(false);
    setCopied(false);
  }, [clearTimers]);

  const startHideTimer = useCallback(() => {
    if (isEditing) return;
    hideTimerRef.current = setTimeout(() => {
      setLinkData(null);
      setIsEditing(false);
    }, 200);
  }, [isEditing]);

  const cancelHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // Select the link mark range in the editor using the stored DOM element
  const selectLinkRange = useCallback((): {
    from: number;
    to: number;
  } | null => {
    if (!linkData) return null;
    const textNode = linkData.element.firstChild;
    if (!textNode) return null;

    const pos = editor.view.posAtDOM(textNode, 0);
    if (pos < 0) return null;

    // Use extendMarkRange to select the full link
    editor.chain().setTextSelection(pos).extendMarkRange("link").run();
    const { from, to } = editor.state.selection;
    return { from, to };
  }, [editor, linkData]);

  const updatePosition = useCallback((element: HTMLAnchorElement) => {
    if (!containerRef.current) return;

    computePosition(element, containerRef.current, {
      placement: "bottom-start",
      middleware: [offset(6), flip({ padding: 16 }), shift({ padding: 16 })],
    }).then(({ x, y }) => {
      setPosition({ x, y });
    });
  }, []);

  // Mouse event handling via event delegation
  useEffect(() => {
    const editorDom = editor.view.dom;

    const handleMouseOver = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      const linkEl = target.closest("a.maek-link") as HTMLAnchorElement | null;
      if (!linkEl) return;

      // Cancel any pending hide
      cancelHideTimer();

      // If already showing this link, skip
      if (linkData?.element === linkEl) return;

      // Start show timer
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      showTimerRef.current = setTimeout(() => {
        const href = linkEl.getAttribute("href") ?? "";
        const text = linkEl.textContent ?? "";
        const isNote = linkEl.classList.contains("maek-note-link");
        setLinkData({ href, text, element: linkEl, isNoteLink: isNote });
        setIsEditing(false);
      }, 300);
    };

    const handleMouseOut = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      const linkEl = target.closest("a.maek-link");
      if (!linkEl) return;

      // If moving to the popover, don't hide
      if (relatedTarget?.closest(".maek-link-hover-menu")) return;

      // Cancel show timer
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }

      startHideTimer();
    };

    editorDom.addEventListener("mouseover", handleMouseOver);
    editorDom.addEventListener("mouseout", handleMouseOut);

    return () => {
      editorDom.removeEventListener("mouseover", handleMouseOver);
      editorDom.removeEventListener("mouseout", handleMouseOut);
      clearTimers();
    };
  }, [editor, linkData, cancelHideTimer, startHideTimer, clearTimers]);

  // Update position when linkData changes
  useEffect(() => {
    if (linkData?.element) {
      // Use requestAnimationFrame to ensure the portal DOM is committed
      requestAnimationFrame(() => {
        updatePosition(linkData.element);
      });
    }
  }, [linkData, updatePosition]);

  // Focus URL input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      requestAnimationFrame(() => {
        urlInputRef.current?.focus();
        urlInputRef.current?.select();
      });
    }
  }, [isEditing]);

  const handleCopy = useCallback(() => {
    if (!linkData) return;
    navigator.clipboard.writeText(linkData.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [linkData]);

  const handleEdit = useCallback(() => {
    if (!linkData) return;
    setEditUrl(linkData.href);
    setEditText(linkData.text);
    setIsEditing(true);
  }, [linkData]);

  const handleOpenWorkspaceTarget = useCallback(async () => {
    if (!linkData) return;
    const opened = await openWorkspaceTargetHref(notePath, linkData.href);
    if (opened) hide();
  }, [linkData, notePath, hide]);

  const handleEditNote = useCallback(() => {
    if (!linkData) return;
    setEditUrl(linkData.href);
    setEditText(linkData.text);
    setIsEditing(true);
  }, [linkData]);

  const handleChangeNote = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    useNotePickerStore
      .getState()
      .open({ x: rect.left, y: rect.bottom + 4 }, (file: FileNode) => {
        const href = workspaceHref(notePath, file.id);
        setEditUrl(href);
      });
  }, [notePath]);

  const handleUnlink = useCallback(() => {
    const range = selectLinkRange();
    if (!range) return;
    editor.chain().focus().setTextSelection(range).unsetLink().run();
    hide();
  }, [editor, selectLinkRange, hide]);

  const handleSave = useCallback(() => {
    if (!linkData) return;

    const href = linkData.isNoteLink
      ? normalizeWorkspaceHref(editUrl)
      : normalizeUrl(editUrl);
    const newText = editText.trim();

    const range = selectLinkRange();
    if (!range) return;

    if (!href) {
      editor.chain().focus().setTextSelection(range).unsetLink().run();
    } else if (newText && newText !== linkData.text) {
      // Text changed → replace text and set link
      editor
        .chain()
        .focus()
        .setTextSelection(range)
        .command(({ tr }) => {
          tr.insertText(newText, range.from, range.to);
          return true;
        })
        .setTextSelection({ from: range.from, to: range.from + newText.length })
        .setLink({ href })
        .run();
    } else {
      // Only URL/href changed
      editor.chain().focus().setTextSelection(range).setLink({ href }).run();
    }

    hide();
  }, [editor, linkData, editUrl, editText, selectLinkRange, hide]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel],
  );

  if (!linkData) return null;

  const linkedAbsPath = linkData.isNoteLink
    ? resolvePath(dirname(notePath), linkData.href)
    : "";
  const workspaceTargetName = linkData.isNoteLink
    ? getWorkspaceTargetDisplayName(linkedAbsPath)
    : "";
  const WorkspaceTargetIcon =
    linkData.isNoteLink && getWorkspaceTargetIsDatabase(linkedAbsPath)
      ? Table
      : FileText;

  return createPortal(
    <div
      ref={containerRef}
      className="maek-link-hover-menu"
      style={{
        position: "fixed",
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onMouseEnter={cancelHideTimer}
      onMouseLeave={() => {
        if (!isEditing) startHideTimer();
      }}
    >
      {isEditing ? (
        <div className="maek-link-hover-edit">
          {linkData.isNoteLink ? (
            <div className="maek-link-hover-edit-row">
              <label className="maek-link-hover-label">Target</label>
              <button
                className="maek-link-hover-note-picker-btn"
                onClick={handleChangeNote}
                title={editUrl}
              >
                <WorkspaceTargetIcon className="maek-link-hover-note-icon" />
                <span className="maek-link-hover-note-name">
                  {workspaceTargetName ||
                    getDisplayName(editUrl.split("/").pop() ?? "")}
                </span>
              </button>
            </div>
          ) : (
            <div className="maek-link-hover-edit-row">
              <label className="maek-link-hover-label">URL</label>
              <input
                ref={urlInputRef}
                type="text"
                className="maek-link-hover-input"
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter URL..."
                spellCheck={false}
              />
            </div>
          )}
          <div className="maek-link-hover-edit-row">
            <label className="maek-link-hover-label">Text</label>
            <input
              ref={linkData.isNoteLink ? urlInputRef : undefined}
              type="text"
              className="maek-link-hover-input"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Link text..."
              spellCheck={false}
            />
          </div>
          <div className="maek-link-hover-edit-actions">
            <button
              className="maek-link-hover-btn save"
              onClick={handleSave}
              aria-label="Save"
            >
              <Check />
            </button>
            <button
              className="maek-link-hover-btn cancel"
              onClick={handleCancel}
              aria-label="Cancel"
            >
              <X />
            </button>
          </div>
        </div>
      ) : (
        <div className="maek-link-hover-preview">
          <span className="maek-link-hover-url" title={linkData.href}>
            {linkData.isNoteLink ? linkData.text : linkData.href}
          </span>
          <div className="maek-link-hover-actions">
            {linkData.isNoteLink ? (
              <>
                <button
                  className="maek-link-hover-btn"
                  onClick={handleOpenWorkspaceTarget}
                  aria-label="Open"
                >
                  <ExternalLink />
                </button>
                <button
                  className="maek-link-hover-btn"
                  onClick={handleEditNote}
                  aria-label="Edit"
                >
                  <Pencil />
                </button>
              </>
            ) : (
              <>
                <button
                  className="maek-link-hover-btn"
                  onClick={handleCopy}
                  aria-label={copied ? "Copied!" : "Copy link"}
                >
                  {copied ? <Check /> : <Copy />}
                </button>
                <button
                  className="maek-link-hover-btn"
                  onClick={handleEdit}
                  aria-label="Edit link"
                >
                  <Pencil />
                </button>
              </>
            )}
            <button
              className="maek-link-hover-btn"
              onClick={handleUnlink}
              aria-label="Unlink"
            >
              <Unlink />
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
