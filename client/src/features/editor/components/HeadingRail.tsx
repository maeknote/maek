import { TextSelection } from "@tiptap/pm/state";
import type { Editor as TiptapEditor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";

interface HeadingRailProps {
  editor: TiptapEditor;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}

type HeadingLevel = 1 | 2 | 3;

interface HeadingRailItem {
  id: string;
  level: HeadingLevel;
  pos: number;
  targetScrollTop: number;
  text: string;
}

const ACTIVE_SCROLL_OFFSET_PX = 56;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getElementFromDomNode(
  domNode: globalThis.Node | null,
): HTMLElement | null {
  if (domNode instanceof HTMLElement) return domNode;
  if (domNode instanceof Text) return domNode.parentElement;
  return null;
}

function getFallbackScrollRatio(pos: number, docSize: number): number {
  if (docSize <= 0) return 0;
  return clamp(pos / docSize, 0, 1);
}

function getHeadingTargetScrollTop(
  editor: TiptapEditor,
  scrollContainer: HTMLDivElement,
  pos: number,
  fallbackRatio: number,
): number {
  const maxScrollTop = Math.max(
    scrollContainer.scrollHeight - scrollContainer.clientHeight,
    0,
  );
  if (maxScrollTop <= 0) return 0;

  const headingElement = getElementFromDomNode(editor.view.nodeDOM(pos));
  if (!headingElement) {
    return fallbackRatio * maxScrollTop;
  }

  const headingRect = headingElement.getBoundingClientRect();
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetScrollTop =
    headingRect.top - containerRect.top + scrollContainer.scrollTop;

  return clamp(targetScrollTop, 0, maxScrollTop);
}

function getActiveHeadingPos(
  headings: HeadingRailItem[],
  scrollContainer: HTMLDivElement | null,
): number | null {
  if (headings.length === 0 || !scrollContainer) return null;

  const currentScrollTop = scrollContainer.scrollTop + ACTIVE_SCROLL_OFFSET_PX;
  let activePos = headings[0]!.pos;

  for (const heading of headings) {
    if (heading.targetScrollTop > currentScrollTop) break;
    activePos = heading.pos;
  }

  return activePos;
}

function collectHeadingRailItems(
  editor: TiptapEditor,
  scrollContainer: HTMLDivElement,
): HeadingRailItem[] {
  const { doc } = editor.state;
  const docSize = doc.content.size;
  const headings: HeadingRailItem[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;

    const level = Number(node.attrs.level);
    if (level !== 1 && level !== 2 && level !== 3) return;

    const fallbackRatio = getFallbackScrollRatio(pos, docSize);
    const targetScrollTop = getHeadingTargetScrollTop(
      editor,
      scrollContainer,
      pos,
      fallbackRatio,
    );
    const text = node.textContent.trim() || `Untitled heading`;

    headings.push({
      id: `${pos}-${level}-${text}`,
      level,
      pos,
      targetScrollTop,
      text,
    });
  });

  return headings;
}

export function HeadingRail({
  editor,
  scrollContainerRef,
}: HeadingRailProps): ReactElement | null {
  const [headings, setHeadings] = useState<HeadingRailItem[]>([]);
  const [activeHeadingPos, setActiveHeadingPos] = useState<number | null>(null);
  const headingsRef = useRef<HeadingRailItem[]>([]);

  const refreshHeadings = useCallback((): void => {
    if (editor.isDestroyed) return;

    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const nextHeadings = collectHeadingRailItems(editor, scrollContainer);
    headingsRef.current = nextHeadings;
    setHeadings(nextHeadings);
    setActiveHeadingPos(getActiveHeadingPos(nextHeadings, scrollContainer));
  }, [editor, scrollContainerRef]);

  const refreshActiveHeading = useCallback((): void => {
    setActiveHeadingPos(
      getActiveHeadingPos(headingsRef.current, scrollContainerRef.current),
    );
  }, [scrollContainerRef]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || editor.isDestroyed) return;

    let frameId: number | null = null;

    const scheduleRefreshHeadings = (): void => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        refreshHeadings();
      });
    };

    const handleScroll = (): void => {
      refreshActiveHeading();
    };

    editor.on("transaction", scheduleRefreshHeadings);
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

    const resizeObserver = new ResizeObserver(scheduleRefreshHeadings);
    resizeObserver.observe(scrollContainer);
    resizeObserver.observe(editor.view.dom);

    scheduleRefreshHeadings();

    return () => {
      editor.off("transaction", scheduleRefreshHeadings);
      scrollContainer.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [editor, refreshActiveHeading, refreshHeadings, scrollContainerRef]);

  const jumpToHeading = useCallback(
    (pos: number): void => {
      if (editor.isDestroyed) return;

      const targetPos = clamp(pos + 1, 1, editor.state.doc.content.size);
      const selection = TextSelection.near(
        editor.state.doc.resolve(targetPos),
        1,
      );
      const transaction = editor.state.tr.setSelection(selection);
      editor.view.dispatch(transaction);
      editor.view.dom.focus({ preventScroll: true });

      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) return;

      const fallbackRatio = getFallbackScrollRatio(
        pos,
        editor.state.doc.content.size,
      );
      const targetScrollTop = getHeadingTargetScrollTop(
        editor,
        scrollContainer,
        pos,
        fallbackRatio,
      );

      requestAnimationFrame(() => {
        scrollContainer.scrollTo({ top: targetScrollTop });
        setActiveHeadingPos(pos);
      });
    },
    [editor, scrollContainerRef],
  );

  if (headings.length === 0) {
    return null;
  }

  return (
    <nav className="maek-heading-rail" aria-label="Document headings">
      <div className="maek-heading-rail-stack">
        {headings.map((heading) => {
          return (
            <button
              key={heading.id}
              type="button"
              className="maek-heading-rail-marker"
              data-active={activeHeadingPos === heading.pos ? "true" : "false"}
              data-heading-level={heading.level}
              aria-current={
                activeHeadingPos === heading.pos ? "location" : undefined
              }
              aria-label={`Jump to heading: ${heading.text}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => jumpToHeading(heading.pos)}
            >
              <span className="maek-heading-rail-label">{heading.text}</span>
              <span className="maek-heading-rail-line" aria-hidden />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
