import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useStore } from './store'

/**
 * Middle-ellipsis that always keeps the extension (design 마이크로 사양).
 * The extension is the part that tells you what kind of thing the tab is, so
 * it is the last thing that may be dropped.
 */
export function truncateName(name: string, max = 22): string {
  if (name.length <= max) return name

  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot) : ''
  const stem = dot > 0 ? name.slice(0, dot) : name

  const keep = Math.max(4, max - ext.length - 1)
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)

  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${ext}`
}

export function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const docs = useStore((s) => s.docs)
  const activateTab = useStore((s) => s.activateTab)
  const closeTab = useStore((s) => s.closeTab)

  const activeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  if (tabs.length === 0) return null

  const requestClose = (id: string, name: string) => {
    if (docs[id]?.dirty && !window.confirm(`${name}에 저장하지 않은 변경이 있습니다. 닫을까요?`)) {
      return
    }
    closeTab(id)
  }

  return (
    <div role="tablist" aria-label="열린 파일" className="flex shrink-0 overflow-x-auto bg-sunken">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId
        const dirty = docs[tab.id]?.dirty ?? false

        return (
          <div
            key={tab.id}
            ref={active ? activeRef : undefined}
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            title={tab.path}
            onClick={() => activateTab(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                activateTab(tab.id)
              }
            }}
            onAuxClick={(e) => {
              if (e.button === 1) requestClose(tab.id, tab.name)
            }}
            /* min-width keeps tabs legible; overflow scrolls rather than crushing. */
            className={`group flex min-w-[120px] max-w-[220px] shrink-0 cursor-default items-center gap-2 border-r border-subtle px-3 py-1.5 text-[13px] ${
              active ? 'bg-canvas text-primary' : 'text-muted hover:bg-hover'
            }`}
          >
            <span className="truncate">{truncateName(tab.name)}</span>

            <span className="ml-auto flex w-4 shrink-0 items-center justify-center">
              {dirty && (
                <span
                  aria-label="저장하지 않음"
                  className="block h-1.5 w-1.5 rounded-full bg-accent group-hover:hidden"
                />
              )}
              <button
                type="button"
                aria-label={`${tab.name} 닫기`}
                className={`rounded-sm p-0.5 hover:bg-active ${dirty ? 'hidden group-hover:block' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  requestClose(tab.id, tab.name)
                }}
              >
                <X size={12} />
              </button>
            </span>
          </div>
        )
      })}
    </div>
  )
}
