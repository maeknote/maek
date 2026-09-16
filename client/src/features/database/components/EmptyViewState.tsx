// EmptyViewState — shared empty-state UI for database views that require a
// specific column type (kanban → select, calendar → date, timeline → date-range).
//
// Mirrors the layout and button style across all three views so that the user
// always sees the same affordance when the view can't be rendered yet.

import type { ReactElement } from 'react'

interface EmptyViewStateProps {
  icon: ReactElement
  title: string
  description: string
  actionLabel: string
  onAction: () => void | Promise<void>
}

export function EmptyViewState({
  icon,
  title,
  description,
  actionLabel,
  onAction
}: EmptyViewStateProps): ReactElement {
  return (
    <div className="flex h-full items-center justify-center text-muted-text">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 opacity-40 flex items-center justify-center">{icon}</div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs opacity-60">{description}</p>
        <button
          onClick={() => void onAction()}
          className="mt-1 px-3 py-1.5 text-xs font-medium rounded-md bg-maek-red text-white hover:bg-maek-red/90 transition-colors"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}
