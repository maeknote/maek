import type { ReactElement } from 'react'
import { ExternalLink, Maximize2 } from 'lucide-react'

interface TitleCellToolbarProps {
  onOpenAsPage: () => void
  onOpenInPopup: () => void
}

export function TitleCellToolbar({
  onOpenAsPage,
  onOpenInPopup
}: TitleCellToolbarProps): ReactElement {
  return (
    <div className="absolute top-0.5 right-0.5 flex items-center gap-0.5 opacity-0 pointer-events-none group-hover/title:opacity-100 group-hover/title:pointer-events-auto transition-opacity">
      <div className="group/btn relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpenAsPage()
          }}
          className="title-cell-action-btn"
          aria-label="Open in new tab"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <span className="pointer-events-none absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover/btn:opacity-100 dark:bg-neutral-700">
          Open in new tab
        </span>
      </div>
      <div className="group/btn relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpenInPopup()
          }}
          className="title-cell-action-btn"
          aria-label="Open in center peek"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
        <span className="pointer-events-none absolute top-full left-1/2 z-10 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover/btn:opacity-100 dark:bg-neutral-700">
          Open in center peek
        </span>
      </div>
    </div>
  )
}
