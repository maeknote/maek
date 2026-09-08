import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react'
import { FolderOpen } from 'lucide-react'
import type { WorkspaceRef, PickDirectoryResult } from '@shared/contract'
import { request } from './notes/api'
import { Button } from './design/Button'
import { FolderSelector } from './design/FolderSelector'
import { Input } from './design/Field'

const KEY = 'oh-my-maek:workspace'
const WorkspaceContext = createContext<WorkspaceRef | null>(null)
export function useWorkspace() {
  const workspace = useContext(WorkspaceContext)
  if (!workspace) throw new Error('워크스페이스가 열리지 않았습니다.')
  return workspace
}

export function WorkspacePicker({
  onSelect,
  current
}: {
  onSelect: (workspace: WorkspaceRef) => Promise<void> | void
  current?: WorkspaceRef
}) {
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState(false)
  const [path, setPath] = useState('')
  const [error, setError] = useState('')
  const run = async (native: boolean) => {
    setBusy(true)
    setError('')
    try {
      if (native) {
        const result = await request<PickDirectoryResult>(
          '/api/workspaces/pick',
          'POST'
        )
        if (result.status === 'ok') await onSelect(result.workspace)
        if (result.status === 'fallback') {
          setManual(true)
          setError(
            '폴더 선택 창을 열 수 없습니다. 폴더의 절대 경로를 입력하세요.'
          )
        }
      } else {
        await onSelect(
          await request<WorkspaceRef>('/api/workspaces/open', 'POST', { path })
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="workspace-picker">
      <FolderSelector
        name={busy ? '폴더 여는 중…' : current ? '다른 폴더 선택' : '폴더 선택'}
        path={current?.root}
        onClick={() => void run(true)}
        disabled={busy}
      />
      {current && <p className="workspace-path">{current.root}</p>}
      <Button variant="link" onClick={() => setManual(!manual)} disabled={busy}>
        경로 직접 입력
      </Button>
      {manual && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void run(false)
          }}
        >
          <label>
            워크스페이스 경로
            <Input
              aria-label="워크스페이스 경로"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/name/Documents/Notes"
              required
            />
          </label>
          <Button
            type="submit"
            variant="default"
            disabled={busy || !path.trim()}
          >
            폴더 열기
          </Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceRef | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const restore = async () => {
      try {
        const path = localStorage.getItem(KEY)
        if (path) {
          const ws = await request<WorkspaceRef>(
            '/api/workspaces/open',
            'POST',
            { path }
          )
          await request('/api/library', 'GET', undefined, ws.wsId)
          if (active) setWorkspace(ws)
        }
      } catch (err) {
        if (active)
          setError(
            `이전 폴더를 열지 못했습니다: ${err instanceof Error ? err.message : err}`
          )
      } finally {
        if (active) setLoading(false)
      }
    }
    void restore()
    return () => {
      active = false
    }
  }, [])
  const select = async (ws: WorkspaceRef) => {
    await request('/api/library', 'GET', undefined, ws.wsId)
    localStorage.setItem(KEY, ws.root)
    history.replaceState(null, '', location.pathname)
    setWorkspace(ws)
    setError('')
  }
  return (
    <WorkspaceActions.Provider value={select}>
      {workspace ? (
        <WorkspaceContext.Provider key={workspace.root} value={workspace}>
          {children}
        </WorkspaceContext.Provider>
      ) : (
        <div className="workspace-gate">
          <section className="glass-modal workspace-welcome">
            <FolderOpen className="workspace-logo" />
            <h1>워크스페이스 열기</h1>
            <p>
              노트를 보관할 로컬 폴더를 선택하세요. 다음 실행 시 이 폴더를
              자동으로 엽니다.
            </p>
            <p>노트는 폴더 안의 notes에, 버전 기록은 history에 저장됩니다.</p>
            {error && <p role="alert">{error}</p>}
            {loading ? (
              <p role="status">이전 워크스페이스 여는 중…</p>
            ) : (
              <WorkspacePicker onSelect={select} />
            )}
          </section>
        </div>
      )}
    </WorkspaceActions.Provider>
  )
}
const WorkspaceActions = createContext<
  (workspace: WorkspaceRef) => Promise<void>
>(async () => {})
export const useSelectWorkspace = () => useContext(WorkspaceActions)
