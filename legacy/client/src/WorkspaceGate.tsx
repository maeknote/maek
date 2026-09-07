import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { rpc } from './api'
import { forgetRecent, readRecents, type RecentWorkspace } from './recents'
import { useOpenWorkspace } from './useOpenWorkspace'

type RecentStatus = 'checking' | 'ok' | 'missing'

/**
 * First screen (T14 / decision 2B).
 *
 * A personal tool reopens the same two or three folders forever, so the recent
 * list is the primary path and [폴더 열기] is the escape hatch — not the other
 * way round. Rows, not cards: a card is only justified when the card itself is
 * the interaction, and these are list items.
 */
export function WorkspaceGate() {
  const { pick, openPath, busy, fallbackReason, error } = useOpenWorkspace()
  const [recents, setRecents] = useState<RecentWorkspace[]>(() => readRecents())
  const [statuses, setStatuses] = useState<Record<string, RecentStatus>>({})
  const [pathInput, setPathInput] = useState('')

  // Verify each remembered path up front so a moved folder is shown as missing
  // instead of failing at click time (design: 경로 소실 → 흐리게 + 찾을 수 없음).
  useEffect(() => {
    let canceled = false
    for (const recent of recents) {
      setStatuses((s) => ({ ...s, [recent.path]: s[recent.path] ?? 'checking' }))
      rpc('openWorkspace', { path: recent.path })
        .then(() => {
          if (!canceled) setStatuses((s) => ({ ...s, [recent.path]: 'ok' }))
        })
        .catch(() => {
          if (!canceled) setStatuses((s) => ({ ...s, [recent.path]: 'missing' }))
        })
    }
    return () => {
      canceled = true
    }
  }, [recents])

  const showPathInput = fallbackReason !== null

  return (
    <div className="h-full overflow-auto bg-canvas">
      <div className="mx-auto max-w-[34rem] px-8 py-16">
        <h1 className="text-[19px] font-semibold tracking-tight text-primary">oh-my-maek</h1>
        <p className="mt-1 text-[13px] text-muted">
          로컬 폴더의 마크다운이 원본입니다. 폴더를 열면 그 안의 <code className="font-mono">.md</code>
          를 그대로 읽고 씁니다.
        </p>

        <button
          autoFocus
          type="button"
          className="btn btn-primary mt-6"
          disabled={busy}
          onClick={() => void pick()}
        >
          <FolderOpen size={14} />
          폴더 열기
        </button>

        {error && (
          <p role="alert" className="mt-3 text-[12px] text-danger">
            {error}
          </p>
        )}

        {showPathInput && (
          <form
            className="mt-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (pathInput.trim()) void openPath(pathInput.trim())
            }}
          >
            <label htmlFor="ws-path" className="block text-[12px] font-medium text-primary">
              폴더 경로
            </label>
            <p className="mt-0.5 text-[12px] text-muted">
              이 환경에서는 네이티브 다이얼로그를 쓸 수 없습니다 ({fallbackReason}). 경로를 직접
              입력하세요.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                id="ws-path"
                className="input flex-1"
                placeholder="~/notes"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <button type="submit" className="btn" disabled={busy || !pathInput.trim()}>
                열기
              </button>
            </div>
          </form>
        )}

        {recents.length > 0 && (
          <section className="mt-10">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted">
              최근 워크스페이스
            </h2>
            <ul className="mt-2 -mx-2">
              {recents.map((recent) => {
                const status = statuses[recent.path] ?? 'checking'
                const missing = status === 'missing'

                return (
                  <li key={recent.path}>
                    <div
                      className={`flex items-center gap-3 rounded-md px-2 py-1.5 ${
                        missing ? 'opacity-50' : 'hover:bg-hover'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={missing || busy}
                        className="min-w-0 flex-1 text-left disabled:cursor-default"
                        onClick={() => void openPath(recent.path)}
                      >
                        <span className="block truncate text-[13px] text-primary">
                          {recent.name}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted">
                          {recent.path}
                        </span>
                      </button>

                      {missing && (
                        <>
                          <span className="shrink-0 text-[11px] text-muted">찾을 수 없음</span>
                          <button
                            type="button"
                            className="shrink-0 text-[11px] text-muted underline underline-offset-2 hover:text-primary"
                            onClick={() => setRecents(forgetRecent(recent.path))}
                          >
                            지우기
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
