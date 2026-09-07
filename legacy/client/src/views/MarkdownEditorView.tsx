import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import type { ConflictReason, ReadFileResult } from '@shared/contract'
import { recomposeSplitFile, splitFrontmatterFile, type SplitFile } from '@shared/frontmatter'
import { ApiError, errorMessage, rpc } from '../api'
import { ConflictDialog } from '../dialogs/ConflictDialog'
import { useDelayed } from '../hooks'
import { registerSave } from '../saveRegistry'
import { useStore } from '../store'
import type { ViewProps } from './index'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; file: ReadFileResult }

export function MarkdownEditorView({ tabId, wsId, path, name, active }: ViewProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [epoch, setEpoch] = useState(0)
  const [forceEdit, setForceEdit] = useState(false)

  useEffect(() => {
    let canceled = false
    setState({ kind: 'loading' })
    rpc('readFile', { wsId, path })
      .then((file) => {
        if (!canceled) setState({ kind: 'ready', file })
      })
      .catch((err) => {
        if (!canceled) setState({ kind: 'error', message: errorMessage(err) })
      })
    return () => {
      canceled = true
    }
  }, [wsId, path, epoch])

  const showSkeleton = useDelayed(state.kind === 'loading')

  if (state.kind === 'loading') {
    return (
      <div className="flex-1 p-8" aria-busy="true">
        {showSkeleton && (
          <div className="mx-auto max-w-[46rem] space-y-3">
            <div className="skeleton h-7 w-1/3" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-11/12" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        )}
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <Notice title="파일을 열 수 없습니다" body={state.message}>
        <button type="button" className="btn" onClick={() => setEpoch((e) => e + 1)}>
          다시 시도
        </button>
      </Notice>
    )
  }

  const { file } = state

  if (file.viewKind === 'unsupported') {
    return (
      <Notice
        title={name}
        body="미리보기를 지원하지 않는 형식입니다. 텍스트가 아니거나 UTF-8이 아닙니다."
        meta={formatBytes(file.size)}
      />
    )
  }

  if (file.viewKind === 'readonly' && !forceEdit) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-subtle bg-sunken px-4 py-2 text-[12px] text-muted">
          <span>
            {formatBytes(file.size)} — 편집기가 느려질 수 있어 읽기 전용으로 엽니다
          </span>
          <button type="button" className="btn btn-small" onClick={() => setForceEdit(true)}>
            그래도 편집하기
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto px-6 py-5 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
          {file.content}
        </pre>
      </div>
    )
  }

  return (
    <MarkdownEditor
      // Remount on reload so Tiptap state and the conflict baseline are
      // replaced together — a partial reset is how baseMtime drifts.
      key={`${path}:${epoch}`}
      tabId={tabId}
      wsId={wsId}
      path={path}
      name={name}
      active={active}
      file={file}
      onReload={() => setEpoch((e) => e + 1)}
    />
  )
}

// ---------------------------------------------------------------------------

interface EditorProps extends ViewProps {
  file: ReadFileResult
  onReload: () => void
}

function MarkdownEditor({ tabId, wsId, path, name, active, file, onReload }: EditorProps) {
  const setDoc = useStore((s) => s.setDoc)
  const closeTab = useStore((s) => s.closeTab)

  const [conflict, setConflict] = useState<ConflictReason | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const original = file.content ?? ''
  const split = useMemo<SplitFile>(() => splitFrontmatterFile(original), [original])

  /** The exact bytes currently believed to be on disk. */
  const originalRef = useRef(original)
  /** The 1A/5B optimistic-lock baseline, advanced only by a successful write. */
  const baseRef = useRef({ mtimeMs: file.mtimeMs, hash: file.hash })
  /** Tiptap's serialization of the untouched document — the dirty yardstick. */
  const baselineRef = useRef<string | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true })
    ],
    content: split.body,
    editorProps: {
      attributes: {
        class: 'prose-body focus:outline-none',
        'aria-label': `${name} 본문`
      }
    },
    onCreate: ({ editor: e }) => {
      baselineRef.current = getMarkdown(e)
    },
    onUpdate: ({ editor: e }) => {
      // Compared against Tiptap's OWN serialization of the pristine document,
      // not against the file bytes: Tiptap normalizes markdown on load, so a
      // file-bytes comparison would report every document as dirty on open.
      const dirty = getMarkdown(e) !== baselineRef.current
      setDoc(tabId, { dirty, status: 'idle' })
    }
  })

  /**
   * Save (T5 write suppression + T15 feedback).
   *
   * Two independent guards keep an unedited open from touching the file:
   *   1. nothing was edited            → no write
   *   2. edited, but the composed bytes equal what is on disk (edit + undo)
   *                                    → no write
   * Tiptap normalizes markdown on every serialize; without these, merely
   * opening a note would rewrite indentation, tables, raw HTML and Obsidian
   * syntax — which is precisely the "files are the truth" violation the design
   * calls out (cross-check 1).
   */
  const save = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!editor) return
      const force = opts?.force === true
      const dirty = useStore.getState().docs[tabId]?.dirty ?? false

      if (!dirty && !force) {
        setDoc(tabId, { status: 'nochange' })
        return
      }

      const next = recomposeSplitFile(split, getMarkdown(editor))
      if (next === originalRef.current && !force) {
        setDoc(tabId, { dirty: false, status: 'nochange' })
        return
      }

      setDoc(tabId, { status: 'saving' })
      setSaveError(null)

      try {
        const res = await rpc('writeFile', {
          wsId,
          path,
          content: next,
          baseMtimeMs: baseRef.current.mtimeMs,
          baseHash: baseRef.current.hash,
          ...(force ? { force: true } : {})
        })
        originalRef.current = next
        baseRef.current = { mtimeMs: res.mtimeMs, hash: res.hash }
        baselineRef.current = getMarkdown(editor)
        setConflict(null)
        setDoc(tabId, { dirty: false, status: 'saved' })
      } catch (err) {
        setDoc(tabId, { status: 'error' })
        if (err instanceof ApiError && err.isConflict) {
          setConflict(err.reason ?? 'changed')
        } else {
          setSaveError(errorMessage(err))
        }
      }
    },
    [editor, path, split, tabId, wsId, setDoc]
  )

  // ⌘S is a window shortcut; the save itself belongs to the mounted view.
  useEffect(() => registerSave(tabId, () => save()), [tabId, save])

  // Clear the transient "저장됨" / "변경 없음" acknowledgement.
  const status = useStore((s) => s.docs[tabId]?.status ?? 'idle')
  useEffect(() => {
    if (status !== 'saved' && status !== 'nochange') return
    const timer = window.setTimeout(() => setDoc(tabId, { status: 'idle' }), 2000)
    return () => window.clearTimeout(timer)
  }, [status, tabId, setDoc])

  // Restore focus to the body when this tab becomes active (A11Y-4: hidden
  // tabs are inert, so focus has to be put back deliberately).
  useEffect(() => {
    if (active && editor && document.activeElement === document.body) {
      editor.commands.focus()
    }
  }, [active, editor])

  const isEmpty = editor?.isEmpty ?? false

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {saveError && (
        <div role="alert" className="border-b border-subtle bg-sunken px-4 py-2 text-[12px] text-danger">
          저장 실패 — {saveError}
        </div>
      )}

      <div className="relative min-h-0 flex-1 overflow-auto">
        <div className="relative mx-auto max-w-[46rem] px-6 py-8">
          {isEmpty && (
            <p className="pointer-events-none absolute left-6 top-8 select-none text-placeholder">
              빈 노트입니다. 여기에 입력하세요.
            </p>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>

      <ConflictDialog
        reason={conflict}
        fileName={name}
        onReload={() => {
          setConflict(null)
          setDoc(tabId, { dirty: false, status: 'idle' })
          onReload()
        }}
        onOverwrite={() => {
          setConflict(null)
          void save({ force: true })
        }}
        onRecreate={() => {
          setConflict(null)
          void save({ force: true })
        }}
        onCloseTab={() => {
          setConflict(null)
          closeTab(tabId)
        }}
        onCancel={() => setConflict(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * tiptap-markdown registers its storage under the extension name at runtime;
 * Tiptap's Storage interface is not augmented for it, hence the narrow cast.
 */
function getMarkdown(editor: Editor): string {
  const markdown = (editor.storage as { markdown?: MarkdownStorage }).markdown
  return markdown?.getMarkdown() ?? ''
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function Notice({
  title,
  body,
  meta,
  children
}: {
  title: string
  body: string
  meta?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline gap-3 border-b border-subtle bg-sunken px-4 py-2">
        <span className="font-mono text-[13px] text-primary">{title}</span>
        {meta && <span className="text-[12px] text-muted">{meta}</span>}
      </div>
      <div className="flex-1 px-6 py-6">
        <p className="max-w-[36rem] text-[13px] leading-relaxed text-muted">{body}</p>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  )
}
