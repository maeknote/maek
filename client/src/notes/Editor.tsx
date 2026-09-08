import { Button } from '../design/Button'
import { Input, Select, Textarea } from '../design/Field'
import { useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import {
  ArrowLeft,
  Bold,
  Italic,
  Heading2,
  List,
  ListTodo,
  Code2,
  Link2,
  Table2,
  Quote,
  Star,
  Copy,
  Download,
  History,
  Trash2,
  RotateCcw,
  Maximize2,
  Minimize2,
  FileText
} from 'lucide-react'
import {
  noteTitle,
  statusSchema,
  type Note,
  type NoteInput,
  type Database
} from '@shared/notes'
import { PropertyInput } from './PropertyInput'
import { Modal } from './Modal'
import { download, request } from './api'
import { serializeYamlData } from '@shared/frontmatter'
import { useWorkspace } from '../Workspace'

export function exportNote(note: Note) {
  const { body, revision: _revision, ...metadata } = note
  download(
    `${noteTitle(note)}.md`,
    `---\n${serializeYamlData(metadata)}\n---\n\n${body}`
  )
}

export function Editor({
  note,
  notes,
  databases,
  edit,
  create,
  open,
  back,
  saveState,
  focus,
  toggleFocus,
  report
}: {
  note: Note
  notes: Note[]
  databases: Database[]
  edit: (id: string, patch: Partial<NoteInput>) => void
  create: (input: Partial<NoteInput>) => Promise<void>
  open: (id: string) => void
  back: () => void
  saveState: string
  focus: boolean
  toggleFocus: () => void
  report: (error: string) => void
}) {
  const [mode, setMode] = useState<'edit' | 'read'>('edit')
  const workspace = useWorkspace()
  const [tag, setTag] = useState('')
  const [versions, setVersions] = useState<Note[] | null>(null)
  const [linkMenu, setLinkMenu] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const database = databases.find((d) => d.id === note.databaseId)
  const patch = (value: Partial<NoteInput>) => edit(note.id, value)
  const insert = (before: string, after = '', fallback = '') => {
    const area = textarea.current
    if (!area || note.trashed) return
    const start = area.selectionStart,
      end = area.selectionEnd
    const selected = note.body.slice(start, end) || fallback
    area.focus()
    // Native text insertion preserves the browser's undo history.
    if (
      !document.execCommand('insertText', false, `${before}${selected}${after}`)
    )
      patch({
        body:
          note.body.slice(0, start) +
          before +
          selected +
          after +
          note.body.slice(end)
      })
  }
  const backlinks = notes.filter(
    (n) => !n.trashed && n.id !== note.id && n.body.includes(`#note/${note.id}`)
  )
  const count = note.body.trim() ? note.body.trim().split(/\s+/).length : 0
  return (
    <section className="editor-pane">
      <header className="editor-topbar">
        <div className="row">
          <Button className="icon-button" aria-label="목록으로" onClick={back}>
            <ArrowLeft size={18} />
          </Button>
          <span className="breadcrumb">
            {database?.name ?? (note.template ? '템플릿' : '내 노트')}
          </span>
          <span className="slash">/</span>
          <span className="truncate">{noteTitle(note)}</span>
        </div>
        <div className="row">
          <span
            className={`save-state ${saveState === '저장 실패' ? 'failed' : ''}`}
            role="status"
          >
            {saveState}
          </span>
          <Button
            className="icon-button"
            aria-label={focus ? '집중 모드 종료' : '집중 모드'}
            onClick={toggleFocus}
          >
            {focus ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </Button>
        </div>
      </header>
      <div className="editor-actions">
        <div className="segmented">
          <Button
            className={mode === 'edit' ? 'selected' : ''}
            onClick={() => setMode('edit')}
          >
            편집
          </Button>
          <Button
            className={mode === 'read' ? 'selected' : ''}
            onClick={() => setMode('read')}
          >
            읽기
          </Button>
        </div>
        <div className="row">
          <Button
            className={`icon-button ${note.favorite ? 'starred' : ''}`}
            aria-label="즐겨찾기"
            aria-pressed={note.favorite}
            disabled={note.trashed}
            onClick={() => patch({ favorite: !note.favorite })}
          >
            <Star size={17} fill={note.favorite ? 'currentColor' : 'none'} />
          </Button>
          <Button
            className="icon-button"
            aria-label="노트 복제"
            onClick={() =>
              void create({
                ...note,
                title: `${noteTitle(note)} 복사본`,
                trashed: false,
                template: false
              })
            }
          >
            <Copy size={17} />
          </Button>
          <Button
            className="icon-button"
            aria-label="Markdown 내보내기"
            onClick={() => exportNote(note)}
          >
            <Download size={17} />
          </Button>
          <Button
            className="icon-button"
            aria-label="버전 기록"
            onClick={() =>
              void request<Note[]>(
                `/api/notes/${note.id}/history`,
                'GET',
                undefined,
                workspace.wsId
              )
                .then(setVersions)
                .catch((err) => report(err.message))
            }
          >
            <History size={17} />
          </Button>
          <Button
            className={`icon-button ${note.template ? 'active' : ''}`}
            aria-label="템플릿으로 지정"
            aria-pressed={note.template}
            disabled={note.trashed}
            onClick={() => patch({ template: !note.template })}
          >
            <FileText size={17} />
          </Button>
          <Button
            className="icon-button"
            aria-label={note.trashed ? '노트 복원' : '휴지통으로 이동'}
            onClick={() => patch({ trashed: !note.trashed })}
          >
            {note.trashed ? <RotateCcw size={17} /> : <Trash2 size={17} />}
          </Button>
        </div>
      </div>
      {note.trashed && (
        <div className="notice">
          휴지통에 있는 노트입니다. 복원하면 다시 편집할 수 있습니다.
          <Button onClick={() => patch({ trashed: false })}>복원</Button>
        </div>
      )}
      <div className="document-scroll">
        <article className="document">
          <div className="eyebrow">
            {note.template ? 'TEMPLATE' : 'YOUR SPACE TO THINK'}
          </div>
          <Input
            className="note-title"
            aria-label="노트 제목"
            placeholder="제목 없는 노트"
            value={note.title}
            maxLength={300}
            disabled={note.trashed}
            onChange={(e) => patch({ title: e.target.value })}
          />
          <div className="note-meta">
            <span>
              {new Date(note.createdAt).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </span>
            <span>·</span>
            <span>{count} 단어</span>
            <span>·</span>
            <span>{Math.max(1, Math.ceil(count / 200))}분 읽기</span>
          </div>
          <div className="tag-row">
            {note.tags.map((t) => (
              <Button
                disabled={note.trashed}
                className="tag"
                key={t}
                title="태그 삭제"
                onClick={() =>
                  patch({ tags: note.tags.filter((v) => v !== t) })
                }
              >
                #{t} <span>×</span>
              </Button>
            ))}
            <Input
              aria-label="태그 추가"
              placeholder="+ 태그 추가"
              value={tag}
              maxLength={60}
              disabled={note.trashed}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  const value = tag.trim().replace(/^#/, '')
                  if (
                    value &&
                    !note.tags.includes(value) &&
                    note.tags.length < 30
                  )
                    patch({ tags: [...note.tags, value] })
                  setTag('')
                }
              }}
            />
          </div>
          <details className="properties" open={!!database}>
            <summary>속성 {database ? `· ${database.name}` : ''}</summary>
            <div className="property-grid">
              <label>
                데이터베이스
                <Select
                  aria-label="노트 데이터베이스"
                  disabled={note.trashed}
                  value={note.databaseId ?? ''}
                  onChange={(e) =>
                    patch({
                      databaseId: e.target.value || null,
                      properties: {}
                    })
                  }
                >
                  <option value="">없음</option>
                  {databases.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </label>
              {database && (
                <>
                  <label>
                    상태
                    <Select
                      aria-label="노트 상태"
                      disabled={note.trashed}
                      value={note.status}
                      onChange={(e) =>
                        patch({ status: statusSchema.parse(e.target.value) })
                      }
                    >
                      {statusSchema.options.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </Select>
                  </label>
                  {database.fields.map((f) => (
                    <label key={f.id}>
                      {f.name}
                      <PropertyInput
                        field={f}
                        value={note.properties[f.id]}
                        disabled={note.trashed}
                        change={(value) =>
                          patch({
                            properties: { ...note.properties, [f.id]: value }
                          })
                        }
                      />
                    </label>
                  ))}
                </>
              )}
            </div>
          </details>
          {mode === 'edit' ? (
            <>
              <div className="formatbar" role="toolbar" aria-label="서식">
                {[
                  [Heading2, '제목', '\n## ', '', '제목'],
                  [Bold, '굵게', '**', '**', '텍스트'],
                  [Italic, '기울임', '*', '*', '텍스트'],
                  [List, '목록', '\n- ', '', '항목'],
                  [ListTodo, '체크리스트', '\n- [ ] ', '', '할 일'],
                  [Quote, '인용', '\n> ', '', '인용문'],
                  [Code2, '코드 블록', '\n```\n', '\n```\n', 'code'],
                  [Link2, '링크', '[', '](https://example.com)', '링크 이름'],
                  [
                    Table2,
                    '표',
                    '\n| 이름 | 내용 |\n| --- | --- |\n| ',
                    ' | 내용 |\n',
                    '항목'
                  ]
                ].map(([Icon, label, before, after, fallback]) => {
                  const Component = Icon as typeof Bold
                  return (
                    <Button
                      key={String(label)}
                      className="icon-button"
                      title={String(label)}
                      aria-label={String(label)}
                      disabled={note.trashed}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() =>
                        insert(String(before), String(after), String(fallback))
                      }
                    >
                      <Component size={17} />
                    </Button>
                  )
                })}
                <Button
                  disabled={note.trashed}
                  className="text-button"
                  onClick={() => setLinkMenu(true)}
                >
                  노트 연결
                </Button>
                <span className="format-hint">Markdown</span>
              </div>
              <Textarea
                ref={textarea}
                className="markdown-editor"
                aria-label="노트 본문"
                placeholder="생각을 적어보세요. 작은 메모도 좋은 시작입니다.\n\n# 제목, - 목록, [ ] 할 일… Markdown을 사용할 수 있어요."
                value={note.body}
                readOnly={note.trashed}
                spellCheck={false}
                onChange={(e) => patch({ body: e.target.value })}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return
                  if ((e.metaKey || e.ctrlKey) && ['b', 'i'].includes(e.key)) {
                    e.preventDefault()
                    insert(
                      e.key === 'b' ? '**' : '*',
                      e.key === 'b' ? '**' : '*',
                      '텍스트'
                    )
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault()
                    insert('  ')
                  }
                }}
              />
            </>
          ) : (
            <div className="markdown-preview">
              <Markdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      onClick={(e) => {
                        if (href?.startsWith('#note/')) {
                          e.preventDefault()
                          open(href.slice(6))
                        }
                      }}
                      target={href?.startsWith('#') ? undefined : '_blank'}
                      rel="noreferrer"
                    >
                      {children}
                    </a>
                  )
                }}
              >
                {note.body || '*아직 내용이 없습니다.*'}
              </Markdown>
            </div>
          )}
          {backlinks.length > 0 && (
            <div className="backlinks">
              <span className="eyebrow">
                이 노트를 언급한 노트 · {backlinks.length}
              </span>
              {backlinks.map((n) => (
                <Button key={n.id} onClick={() => open(n.id)}>
                  <Link2 size={14} />
                  {noteTitle(n)}
                </Button>
              ))}
            </div>
          )}
        </article>
      </div>
      <footer className="editor-footer">
        <span>로컬에 보관되는 나만의 노트</span>
        <span>
          {note.body.length.toLocaleString()}자{' '}
          <span className="footer-dot">·</span> ⌘ / Ctrl + S 저장
        </span>
      </footer>
      {versions && (
        <Modal
          title="버전 기록"
          description="최근 30개 저장본입니다. 복원 전의 현재 내용도 기록에 남습니다."
          close={() => setVersions(null)}
        >
          {versions.length ? (
            versions.map((v) => (
              <div className="version" key={v.revision}>
                <div>
                  <strong>
                    {new Date(v.updatedAt).toLocaleString('ko-KR')}
                  </strong>
                  <p>
                    {noteTitle(v)} · {v.body.length}자
                  </p>
                  <pre>{v.body.slice(0, 180)}</pre>
                </div>
                <Button
                  className="secondary"
                  onClick={() => {
                    patch({ title: v.title, body: v.body, tags: v.tags })
                    setVersions(null)
                  }}
                >
                  내용 복원
                </Button>
              </div>
            ))
          ) : (
            <p className="empty-small">아직 이전 버전이 없습니다.</p>
          )}
        </Modal>
      )}
      {linkMenu && (
        <Modal
          title="노트 연결"
          description="선택한 노트의 링크를 본문에 삽입합니다."
          close={() => setLinkMenu(false)}
        >
          {notes
            .filter((n) => n.id !== note.id && !n.trashed)
            .map((n) => (
              <Button
                className="picker-item"
                key={n.id}
                onClick={() => {
                  insert(
                    `[${noteTitle(n).replace(/[\[\]]/g, '')}](#note/${n.id})`
                  )
                  setLinkMenu(false)
                }}
              >
                <FileText size={16} />
                {noteTitle(n)}
              </Button>
            ))}
        </Modal>
      )}
    </section>
  )
}
