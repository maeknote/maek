import { Group, Panel, Separator } from 'react-resizable-panels'
import { House, Moon, PanelLeft } from 'lucide-react'
import { Explorer } from './Explorer'
import { TabBar } from './TabBar'
import { TabViews } from './Tab'
import { useBreakpoint } from './hooks'
import { useStore, type SaveStatus } from './store'
import { cycleTheme } from './theme'
import { useOpenWorkspace } from './useOpenWorkspace'

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saving: '저장 중…',
  saved: '저장됨',
  nochange: '변경 없음',
  error: '저장 실패'
}

export function MainLayout() {
  const workspace = useStore((s) => s.workspace)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const docs = useStore((s) => s.docs)
  const explorerOpen = useStore((s) => s.explorerOpen)
  const toggleExplorer = useStore((s) => s.toggleExplorer)
  const setWorkspace = useStore((s) => s.setWorkspace)
  const staleWorkspace = useStore((s) => s.staleWorkspace)

  const { pick } = useOpenWorkspace()
  const breakpoint = useBreakpoint()

  if (!workspace) return null

  // <600px: the design deliberately does not support this — mouse+keyboard on a
  // desktop browser is the only target, so say so rather than reflow badly.
  if (breakpoint === 'unsupported') {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="text-[13px] text-muted">창을 넓혀주세요 (최소 600px)</p>
      </div>
    )
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
  const status = activeTabId ? docs[activeTabId]?.status ?? 'idle' : 'idle'
  const dirty = activeTabId ? docs[activeTabId]?.dirty ?? false : false

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col border-r border-subtle bg-panel">
      <div className="min-h-0 flex-1">
        <Explorer />
      </div>
      <div className="flex items-center gap-1 border-t border-subtle px-2 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-muted hover:bg-hover hover:text-primary"
          title={`${workspace.root} — 클릭하면 다른 폴더를 엽니다`}
          onClick={() => void pick()}
        >
          <House size={12} className="shrink-0" />
          <span className="truncate">{workspace.name}</span>
        </button>
        <button
          type="button"
          className="rounded-md p-1 text-muted hover:bg-hover hover:text-primary"
          title="테마 전환 (시스템 → 밝게 → 어둡게)"
          onClick={() => cycleTheme()}
        >
          <Moon size={13} />
        </button>
      </div>
    </div>
  )

  const main = (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-canvas">
      <div className="flex shrink-0 items-stretch bg-sunken">
        {breakpoint === 'narrow' && (
          <button
            type="button"
            className="px-2.5 text-muted hover:bg-hover hover:text-primary"
            title="탐색기 (⌘B)"
            aria-expanded={explorerOpen}
            onClick={() => toggleExplorer()}
          >
            <PanelLeft size={14} />
          </button>
        )}
        <TabBar />
      </div>

      {/* Low-contrast status strip: path on the left, save acknowledgement on
          the right. This is the only place T5's write suppression is visible. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-subtle px-4 py-1 text-[11px] text-muted">
        <span className="truncate font-mono" title={activeTab?.path}>
          {activeTab?.path ?? ''}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5" aria-live="polite">
          {STATUS_TEXT[status]}
          {dirty && <span className="block h-1.5 w-1.5 rounded-full bg-accent" aria-label="저장하지 않음" />}
        </span>
      </div>

      {staleWorkspace && (
        <div role="alert" className="shrink-0 border-b border-subtle bg-sunken px-4 py-2 text-[12px]">
          서버가 재시작되어 워크스페이스 연결이 끊겼습니다.{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setWorkspace(null)}
          >
            다시 열기
          </button>
        </div>
      )}

      <TabViews />
    </div>
  )

  if (breakpoint === 'narrow') {
    // Explorer becomes an overlay, closed by default (⌘B toggles).
    return (
      <div className="relative flex h-full">
        {main}
        {explorerOpen && (
          <>
            <div
              className="absolute inset-0 z-10 bg-scrim"
              onClick={() => toggleExplorer(false)}
              aria-hidden="true"
            />
            <div className="absolute inset-y-0 left-0 z-20 w-[240px] shadow-[var(--shadow-floating)]">
              {sidebar}
            </div>
          </>
        )}
      </div>
    )
  }

  // Numeric sizes are pixels in react-resizable-panels v4, so the design's
  // px breakpoints map across directly.
  return (
    <Group orientation="horizontal" className="h-full">
      <Panel
        // Re-key on breakpoint so the 240px→200px change actually takes effect
        // instead of being pinned by the panel's remembered size.
        key={breakpoint}
        defaultSize={breakpoint === 'wide' ? 240 : 200}
        minSize={160}
        maxSize="40"
        className="min-h-0"
      >
        {sidebar}
      </Panel>
      <Separator className="w-px bg-transparent transition-colors hover:bg-accent data-[state=dragging]:bg-accent" />
      <Panel className="min-h-0">{main}</Panel>
    </Group>
  )
}
