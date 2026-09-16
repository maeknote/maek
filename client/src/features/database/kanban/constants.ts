// Kanban feature constants — shared between reducer, board, lane, and card.
//
// Only cards are draggable. Each lane owns one vertical Droppable of type
// 'kanban-card', keyed by laneDroppableId(option).
//
// The UNCATEGORIZED sentinel represents the implicit "No Value" lane: rows whose
// select value is empty or does not match any known option. It never appears in
// groupColumn.options.

export const UNCATEGORIZED = '__uncategorized__'

export const DRAG_TYPE_CARD = 'kanban-card'

/** Encode a lane's droppable id. Includes the type prefix so parseLaneDroppableId
 *  can distinguish it from DROPPABLE_BOARD even if option values collide. */
export function laneDroppableId(laneKey: string): string {
  return `lane:${laneKey}`
}

export function parseLaneDroppableId(id: string): string | null {
  return id.startsWith('lane:') ? id.slice(5) : null
}

// ──────────────────────────────────────────────────
// Lane color presets (shared by LaneColorMenu + KanbanLane)
// ──────────────────────────────────────────────────

export interface LaneColorPreset {
  key: string
  label: string
  bg: string
  dot: string
  ring: string
}

export const LANE_COLOR_PRESETS: LaneColorPreset[] = [
  { key: 'none', label: 'Default', bg: '', dot: 'bg-neutral-400/40', ring: '' },
  {
    key: 'red',
    label: 'Red',
    bg: 'bg-red-500/[0.08] dark:bg-red-500/10',
    dot: 'bg-red-500',
    ring: 'ring-red-400/30'
  },
  {
    key: 'orange',
    label: 'Orange',
    bg: 'bg-orange-500/[0.08] dark:bg-orange-500/10',
    dot: 'bg-orange-500',
    ring: 'ring-orange-400/30'
  },
  {
    key: 'amber',
    label: 'Amber',
    bg: 'bg-amber-500/[0.08] dark:bg-amber-500/10',
    dot: 'bg-amber-500',
    ring: 'ring-amber-400/30'
  },
  {
    key: 'green',
    label: 'Green',
    bg: 'bg-emerald-500/[0.08] dark:bg-emerald-500/10',
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-400/30'
  },
  {
    key: 'blue',
    label: 'Blue',
    bg: 'bg-blue-500/[0.08] dark:bg-blue-500/10',
    dot: 'bg-blue-500',
    ring: 'ring-blue-400/30'
  },
  {
    key: 'violet',
    label: 'Violet',
    bg: 'bg-violet-500/[0.08] dark:bg-violet-500/10',
    dot: 'bg-violet-500',
    ring: 'ring-violet-400/30'
  },
  {
    key: 'pink',
    label: 'Pink',
    bg: 'bg-pink-500/[0.08] dark:bg-pink-500/10',
    dot: 'bg-pink-500',
    ring: 'ring-pink-400/30'
  },
  {
    key: 'gray',
    label: 'Gray',
    bg: 'bg-neutral-500/[0.08] dark:bg-neutral-500/10',
    dot: 'bg-neutral-500',
    ring: 'ring-neutral-400/30'
  }
]

export function getColorPreset(key: string | undefined): LaneColorPreset {
  return LANE_COLOR_PRESETS.find((p) => p.key === key) ?? LANE_COLOR_PRESETS[0]!
}
