import React from "react";

interface HighlightMatchProps {
  text: string;
  indices: Array<[number, number]>;
  className?: string;
}

export function HighlightMatch({
  text,
  indices,
  className,
}: HighlightMatchProps): React.ReactNode {
  if (indices.length === 0) return text;

  const sorted = [...indices].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const [s, e] = merged[i]!;
    if (s > cursor) parts.push(text.slice(cursor, s));
    parts.push(
      <span key={i} className={className ?? "font-semibold text-neutral-ink"}>
        {text.slice(s, e)}
      </span>,
    );
    cursor = e;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
