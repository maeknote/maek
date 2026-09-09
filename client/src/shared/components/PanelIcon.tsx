interface PanelIconProps {
  /** Which side the panel is on */
  side: "left" | "right";
  /** Whether the panel is currently expanded/visible */
  isExpanded: boolean;
  /** Icon size in pixels */
  size?: number;
  className?: string;
}

/**
 * Custom icon showing a window frame with a panel indicator.
 * - Expanded state: panel area is highlighted with accent color
 * - Collapsed state: panel area is dimmed
 */
export function PanelIcon({
  side,
  isExpanded,
  size = 16,
  className,
}: PanelIconProps) {
  // Calculate dimensions based on size
  const frameWidth = size;
  const frameHeight = size * 0.75; // 4:3 aspect ratio
  const strokeWidth = 1.3;
  const cornerRadius = 2;
  const panelWidth = isExpanded ? frameWidth * 0.33 : frameWidth * 0.2;
  const panelInset = 2.2; // Inset from frame edges
  const panelHeight = frameHeight - panelInset * 2;

  // Panel position
  const panelX =
    side === "left" ? panelInset : frameWidth - panelWidth - panelInset;

  // Colors - all use currentColor for consistency
  const frameColor = "currentColor";
  const panelColor = "currentColor";
  const frameOpacity = 1;
  const panelOpacity = 1;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${frameWidth} ${frameHeight}`}
      fill="none"
      className={className}
      style={{ display: "block" }}
    >
      {/* Window frame */}
      <rect
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={frameWidth - strokeWidth}
        height={frameHeight - strokeWidth}
        rx={cornerRadius}
        stroke={frameColor}
        strokeWidth={strokeWidth}
        fill="none"
        opacity={frameOpacity}
      />

      {/* Panel indicator */}
      <rect
        x={panelX}
        y={panelInset}
        width={panelWidth}
        height={panelHeight}
        rx={1}
        fill={panelColor}
        opacity={panelOpacity}
        style={{ transition: "all 0.2s ease" }}
      />
    </svg>
  );
}
