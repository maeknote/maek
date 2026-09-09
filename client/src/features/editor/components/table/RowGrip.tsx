import { EllipsisVertical } from "lucide-react";
import { useCallback } from "react";

interface RowGripProps {
  rowIndex: number;
  isHeader: boolean;
  top: number;
  height: number;
  onMenuOpen: (rowIndex: number, position: { x: number; y: number }) => void;
}

export function RowGrip({
  rowIndex,
  isHeader,
  top,
  height,
  onMenuOpen,
}: RowGripProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      onMenuOpen(rowIndex, { x: rect.left, y: rect.bottom + 4 });
    },
    [rowIndex, onMenuOpen],
  );

  return (
    <div
      className={`maek-table-row-grip ${isHeader ? "is-header" : ""}`}
      style={{
        top: top,
        height: height,
      }}
      onClick={handleClick}
      title={isHeader ? "Header row" : "Row options"}
    >
      <EllipsisVertical className="w-3.5 h-3.5" />
    </div>
  );
}
