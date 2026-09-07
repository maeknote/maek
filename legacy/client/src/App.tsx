import { useEffect } from 'react'
import { MainLayout } from './MainLayout'
import { WorkspaceGate } from './WorkspaceGate'
import { runSave } from './saveRegistry'
import { useStore } from './store'
import { useOpenWorkspace } from './useOpenWorkspace'

export default function App() {
  const workspace = useStore((s) => s.workspace)
  useGlobalShortcuts()

  return workspace ? <MainLayout /> : <WorkspaceGate />
}

/**
 * Milestone 1 must be completable with the keyboard alone.
 *
 * ⌘W is registered but browsers reserve it and will usually close the browser
 * tab first — it is here so the binding exists where the platform allows it,
 * not as the only way to close a tab (the tab's × is always present).
 */
function useGlobalShortcuts() {
  const { pick } = useOpenWorkspace()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const store = useStore.getState()

      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        runSave(store.activeTabId)
        return
      }

      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void pick().then((outcome) => {
          if (outcome === 'fallback') {
            window.alert('네이티브 폴더 다이얼로그를 쓸 수 없습니다. 워크스페이스 화면에서 경로를 입력하세요.')
          }
        })
        return
      }

      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        store.toggleExplorer()
        return
      }

      if (mod && e.key.toLowerCase() === 'w' && store.activeTabId) {
        e.preventDefault()
        store.closeTab(store.activeTabId)
        return
      }

      if (mod && /^[1-9]$/.test(e.key)) {
        const tab = store.tabs[Number(e.key) - 1]
        if (tab) {
          e.preventDefault()
          store.activateTab(tab.id)
        }
        return
      }

      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        store.activateTabByOffset(e.shiftKey ? -1 : 1)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pick])
}
