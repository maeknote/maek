import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Trash2 } from "lucide-react";
import { basename, dirname, resolvePath } from "@renderer/lib/pathUtils";
import { bytesToBlobUrl, inferMimeFromPath } from "../preview/utils";
import { useImageResizeStore } from "../../stores/imageResizeStore";
import { rawUrl } from "../../../../host";

type ResolvedImageSource =
  | { kind: "none" }
  | { kind: "direct"; src: string }
  | { kind: "file"; filePath: string };

const imageBlobUrlCache = new Map<string, string>();
const imageBlobUrlPromiseCache = new Map<string, Promise<string>>();

function isDirectRenderableUrl(value: string): boolean {
  return /^(data:|blob:|https?:)/i.test(value);
}

function toFilePathFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
}

function resolveImageSource(
  src: string,
  notePath: string,
): ResolvedImageSource {
  const trimmed = src.trim();
  if (!trimmed) return { kind: "none" };

  if (isDirectRenderableUrl(trimmed)) {
    return { kind: "direct", src: trimmed };
  }

  if (/^file:\/\//i.test(trimmed)) {
    const filePath = toFilePathFromUrl(trimmed);
    return filePath ? { kind: "file", filePath } : { kind: "none" };
  }

  if (trimmed.startsWith("/")) {
    return { kind: "file", filePath: trimmed };
  }

  if (!notePath) return { kind: "none" };

  return {
    kind: "file",
    filePath: resolvePath(dirname(notePath), trimmed),
  };
}

async function loadImageBlobUrl(filePath: string): Promise<string> {
  const cacheKey = rawUrl(filePath);
  const cached = imageBlobUrlCache.get(cacheKey);
  if (cached) return cached;

  const pending = imageBlobUrlPromiseCache.get(cacheKey);
  if (pending) return pending;

  const nextPromise = window.api
    .readPreviewSource(filePath)
    .then((result) => {
      if (!result.success) {
        throw new Error(result.error);
      }

      const mimeType = result.mime ?? inferMimeFromPath(filePath);
      const blobUrl = bytesToBlobUrl(result.bytes, mimeType);
      imageBlobUrlCache.set(cacheKey, blobUrl);
      imageBlobUrlPromiseCache.delete(cacheKey);
      return blobUrl;
    })
    .catch((error) => {
      imageBlobUrlPromiseCache.delete(cacheKey);
      throw error;
    });

  imageBlobUrlPromiseCache.set(cacheKey, nextPromise);
  return nextPromise;
}

const DEFAULT_WIDTH_PERCENT = 50;
const MAX_WIDTH_PERCENT = 100;
const MIN_WIDTH_PERCENT = 15;

export function ImageView(props: NodeViewProps) {
  const { deleteNode, selected } = props;
  const src =
    typeof props.node.attrs.src === "string" ? props.node.attrs.src : "";
  const alt =
    typeof props.node.attrs.alt === "string" ? props.node.attrs.alt : "";
  const fallbackLabel = alt || basename(src) || "Image";
  const notePath =
    typeof props.extension.options.notePath === "string"
      ? props.extension.options.notePath
      : "";
  const resolvedSource = useMemo(
    () => resolveImageSource(src, notePath),
    [notePath, src],
  );
  const [renderSrc, setRenderSrc] = useState("");
  const [hasLoadError, setHasLoadError] = useState(false);

  // --- Resize state (session only) ---
  const resizeKey = notePath && src ? `${notePath}::${src}` : "";
  const storedSize = useImageResizeStore((s) =>
    resizeKey ? s.sizes[resizeKey] : undefined,
  );
  const setStoredSize = useImageResizeStore((s) => s.setSize);
  // During drag, use local override; otherwise use store value (survives tab switches)
  const [dragWidthPercent, setDragWidthPercent] = useState<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const widthPercent = dragWidthPercent ?? storedSize ?? DEFAULT_WIDTH_PERCENT;

  // --- Delete handler ---
  const handleDelete = useCallback(() => {
    if (
      resolvedSource.kind === "file" &&
      resolvedSource.filePath.includes(".maek-assets/")
    ) {
      window.api.deleteFile(resolvedSource.filePath); // fire-and-forget
    }
    deleteNode();
  }, [resolvedSource, deleteNode]);

  // --- Resize handler ---
  const handleResizeStart = useCallback(
    (direction: "right" | "bottom" | "corner", e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const container = containerRef.current?.parentElement;
      const imgEl = containerRef.current?.querySelector("img");
      if (!container || !imgEl) return;

      const containerWidth = container.getBoundingClientRect().width;
      const imgRect = imgEl.getBoundingClientRect();
      const aspectRatio = imgRect.width / imgRect.height;
      const startX = e.clientX;
      const startY = e.clientY;
      const startPercent = widthPercent;

      setIsResizing(true);
      let lastPercent = startPercent;

      const onMove = (ev: MouseEvent): void => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let deltaPercent: number;
        if (direction === "right") {
          deltaPercent = (dx / containerWidth) * 100;
        } else if (direction === "bottom") {
          deltaPercent = ((dy * aspectRatio) / containerWidth) * 100;
        } else {
          deltaPercent = ((dx + dy * aspectRatio) / 2 / containerWidth) * 100;
        }
        const next = Math.round(
          Math.max(
            MIN_WIDTH_PERCENT,
            Math.min(MAX_WIDTH_PERCENT, startPercent + deltaPercent),
          ),
        );
        lastPercent = next;
        setDragWidthPercent(next);
      };

      const onUp = (): void => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setIsResizing(false);
        setDragWidthPercent(null);
        if (resizeKey) setStoredSize(resizeKey, lastPercent);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [widthPercent, resizeKey, setStoredSize],
  );

  useEffect(() => {
    setHasLoadError(false);
    setRenderSrc("");

    if (resolvedSource.kind === "none") {
      return;
    }

    if (resolvedSource.kind === "direct") {
      setRenderSrc(resolvedSource.src);
      return;
    }

    let cancelled = false;
    void loadImageBlobUrl(resolvedSource.filePath)
      .then((blobUrl) => {
        if (!cancelled) {
          setRenderSrc(blobUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasLoadError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedSource]);

  const imageLoaded = renderSrc && !hasLoadError;
  const nodeClassName = `maek-note-image-node${selected ? " is-selected" : ""}${isResizing ? " is-resizing" : ""}`;

  return (
    <NodeViewWrapper as="figure" className={nodeClassName} data-drag-handle>
      {imageLoaded ? (
        <div
          ref={containerRef}
          className="maek-note-image-container"
          style={{ width: `${widthPercent}%` }}
        >
          <img
            src={renderSrc}
            alt={alt || fallbackLabel}
            className="maek-note-image-render"
            draggable={false}
            contentEditable={false}
            loading="lazy"
            onError={() => setHasLoadError(true)}
          />
          <button
            type="button"
            className="maek-note-image-delete"
            contentEditable={false}
            onClick={handleDelete}
            aria-label="Delete image"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <div
            className="maek-note-image-resize-handle-right"
            contentEditable={false}
            onMouseDown={(e) => handleResizeStart("right", e)}
          />
          <div
            className="maek-note-image-resize-handle-bottom"
            contentEditable={false}
            onMouseDown={(e) => handleResizeStart("bottom", e)}
          />
          <div
            className="maek-note-image-resize-handle-corner"
            contentEditable={false}
            onMouseDown={(e) => handleResizeStart("corner", e)}
          />
        </div>
      ) : (
        <div className="maek-note-image-fallback" contentEditable={false}>
          <div className="maek-note-image-fallback-label">{fallbackLabel}</div>
          <div className="maek-note-image-fallback-status">
            Failed to load image preview
          </div>
          {src && <div className="maek-note-image-fallback-path">{src}</div>}
        </div>
      )}
    </NodeViewWrapper>
  );
}
