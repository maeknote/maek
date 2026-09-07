import { useCallback, useState } from 'react'
import type { WorkspaceRef } from '@shared/contract'
import { errorMessage, rpc } from './api'
import { rememberRecent } from './recents'
import { useStore } from './store'

/**
 * The two ways into a workspace (3A): the server-spawned native dialog, and
 * the path-input fallback that also powers the recents list.
 */
export function useOpenWorkspace() {
  const setWorkspace = useStore((s) => s.setWorkspace)
  const [busy, setBusy] = useState(false)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const adopt = useCallback(
    (ws: WorkspaceRef) => {
      rememberRecent({ path: ws.root, name: ws.name })
      setWorkspace(ws)
    },
    [setWorkspace]
  )

  const pick = useCallback(async (): Promise<'ok' | 'canceled' | 'fallback'> => {
    setBusy(true)
    setError(null)
    try {
      const res = await rpc('pickDirectory', {})
      switch (res.status) {
        case 'ok':
          adopt(res.workspace)
          return 'ok'
        case 'canceled':
          // Nothing changes — the user is returned exactly where they were.
          return 'canceled'
        case 'fallback':
          setFallbackReason(res.reason)
          return 'fallback'
      }
    } catch (err) {
      setError(errorMessage(err))
      return 'canceled'
    } finally {
      setBusy(false)
    }
  }, [adopt])

  const openPath = useCallback(
    async (path: string): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        const { workspace } = await rpc('openWorkspace', { path })
        adopt(workspace)
        return true
      } catch (err) {
        setError(errorMessage(err))
        return false
      } finally {
        setBusy(false)
      }
    },
    [adopt]
  )

  return { pick, openPath, busy, fallbackReason, error, setError }
}
