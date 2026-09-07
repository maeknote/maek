import { useStore } from './store'
import { getView, resolveViewId } from './views'

/**
 * The view host (decision 3A + A11Y-4).
 *
 * Every open tab stays MOUNTED. Unmounting a background tab would throw away
 * the Tiptap state, the undo stack and the cursor — and worse, remounting
 * re-reads the file, which silently refreshes `baseMtime` and disarms the 1A
 * conflict check. Keeping the mount is what makes optimistic locking mean
 * anything across tabs.
 *
 * `display:none` alone is not enough: the hidden editor's focusable nodes stay
 * in the Tab order and in the screen-reader tree, so a keyboard user walks into
 * an editor they cannot see. `inert` removes it from focus, clicks and the AT
 * tree in one attribute.
 */
export function TabViews() {
  const workspace = useStore((s) => s.workspace)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)

  if (!workspace) return null

  if (tabs.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[13px] text-muted">왼쪽에서 파일을 선택하세요</p>
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        const View = getView(resolveViewId(tab.path))

        return (
          <div
            key={tab.id}
            inert={!active}
            aria-hidden={!active}
            className="absolute inset-0 flex min-h-0 flex-col bg-canvas"
            style={{ display: active ? 'flex' : 'none' }}
          >
            <View
              tabId={tab.id}
              wsId={workspace.wsId}
              path={tab.path}
              name={tab.name}
              active={active}
            />
          </div>
        )
      })}
    </div>
  )
}
