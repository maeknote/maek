import { EllipsisVertical } from "lucide-react";
import { useCallback } from "react";

interface ColumnGripProps {
  colIndex: number;
  left: number;
  width: number;
  onMenuOpen: (colIndex: number, position: { x: number; y: number }) => void;
}

export function ColumnGrip({
  colIndex,
  left,
  width,
  onMenuOpen,
}: ColumnGripProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      onMenuOpen(colIndex, {
        x: rect.left + rect.width / 2,
        y: rect.bottom + 4,
      });
    },
    [colIndex, onMenuOpen],
  );

  return (
    <div
      className="maek-table-column-grip"
      style={{
        left: left,
        width: width,
      }}
      onClick={handleClick}
      title="Column options"
    >
      <EllipsisVertical className="w-3.5 h-3.5 rotate-90" />
    </div>
  );
}
