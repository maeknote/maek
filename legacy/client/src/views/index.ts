import type { ComponentType } from 'react'
import { MarkdownEditorView } from './MarkdownEditorView'

/**
 * View slot boundary (T8 / D9).
 *
 * The view runtime CONTRACT is deliberately not designed yet — it is the most
 * uncertain subsystem and it is better drawn against a working shell than
 * imagined. What is fixed now is only the slot: a tab's content is a
 * *replaceable view*, never an editor bolted into the tab. That guarantees
 * DatabaseView and the runtime-loaded HtmlView have a structural place to go.
 *
 * Milestone 1 registers exactly one view. Resist adding a capability object,
 * a lifecycle, or a postMessage bridge here — that is step 8, not step 5.
 */
export interface ViewProps {
  tabId: string
  wsId: string
  /** Workspace-relative path. */
  path: string
  name: string
  /** False while the tab is in the background but still mounted (3A). */
  active: boolean
}

export type ViewComponent = ComponentType<ViewProps>

export type ViewId = 'markdown'

const registry: Record<ViewId, ViewComponent> = {
  markdown: MarkdownEditorView
}

/**
 * Which view handles this file. Everything routes to the markdown view for
 * now; it renders the server's readonly/unsupported outcomes itself (7A),
 * because those are states of one file, not different tab content types.
 */
export function resolveViewId(_path: string): ViewId {
  return 'markdown'
}

export function getView(id: ViewId): ViewComponent {
  return registry[id]
}
