import { Button } from '../design/Button'
import { Input, Select } from '../design/Field'
import { Header } from '../design/Header'
import { FolderSelector } from '../design/FolderSelector'
import { useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  FileText,
  Search,
  Plus,
  Star,
  Trash2,
  Table2,
  LayoutTemplate,
  Sun,
  Moon,
  Upload,
  ArrowUpDown,
  X,
  Feather,
  Download
} from 'lucide-react'
import { noteTitle, type NoteInput } from '@shared/notes'
import { parseYamlData, splitFrontmatterFile } from '@shared/frontmatter'
import { useLibrary } from './useLibrary'
import { Editor, exportNote } from './Editor'
import { DatabaseView } from './DatabaseView'
import { Modal } from './Modal'
import { download } from './api'
import { useTheme } from '../design/DesignProvider'
import { useWorkspace, useSelectWorkspace, WorkspacePicker } from '../Workspace'

type Section = 'notes' | 'favorites' | 'templates' | 'trash' | 'databases'
const labels = {
  notes: '모든 노트',
  favorites: '즐겨찾기',
  templates: '템플릿',
  trash: '휴지통',
  databases: '데이터베이스'
}
const builtins = [
  {
    title: '오늘의 노트',
    body: '## 오늘의 초점\n\n\n## 할 일\n\n- [ ] \n\n## 기억하고 싶은 것\n\n',
    tags: ['일상']
  },
  {
    title: '회의 노트',
    body: '## 안건\n\n\n## 논의 내용\n\n\n## 결정 사항\n\n\n## 다음 행동\n\n- [ ] \n',
    tags: ['회의']
  },
  {
    title: '아이디어',
    body: '## 한 문장으로\n\n\n## 어떤 문제를 해결하나요?\n\n\n## 작게 시작한다면\n\n- [ ] \n',
    tags: ['아이디어']
  }
]
const welcome = {
  title: '작은 메모에서 시작하는 공간',
  tags: ['시작하기'],
  body: '# 반가워요, oh-my-maek입니다.\n\n생각을 적고, 연결하고, 조금씩 정리하는 나만의 공간이에요.\n\n## 가볍게 적어보세요\n\n노트는 자동으로 저장됩니다. **굵게**, *기울임*, 제목, 목록, 표, 코드와 수식을 사용할 수 있어요. 위의 **읽기** 버튼으로 완성된 문서를 확인하세요.\n\n- [ ] 오늘 떠오른 생각 하나 적기\n- [ ] 태그를 추가하고 즐겨찾기 해보기\n- [ ] 데이터베이스에 노트 모아보기\n\n## 생각을 연결하세요\n\n도구 모음의 **노트 연결**로 다른 노트를 참조할 수 있어요. 연결된 노트 아래에는 이 노트를 언급한 문서가 나타납니다.\n\n> 모든 노트는 이 컴퓨터에 Markdown 파일로 보관됩니다. 내보내기로 어디든 가져가세요.\n\n## 정리가 필요할 때\n\n데이터베이스를 만들고 노트를 행으로 추가하세요. 표에서는 속성을 편집하고, 보드에서는 할 일 → 진행 중 → 완료로 상태를 옮길 수 있습니다.\n'
}

export default function NotesApp() {
  const library = useLibrary()
  const workspace = useWorkspace()
  const selectWorkspace = useSelectWorkspace()
  const [workspaceSettings, setWorkspaceSettings] = useState(false)
  const { dark, toggle: toggleTheme } = useTheme()
  const [section, setSection] = useState<Section>('notes')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [databaseId, setDatabaseId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState('updated')
  const [focus, setFocus] = useState(false)
  const [newMenu, setNewMenu] = useState(false)
  const [dbModal, setDbModal] = useState(false)
  const [dbName, setDbName] = useState('')
  const [busy, setBusy] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const importer = useRef<HTMLInputElement>(null)
  const active = library.notes.find((n) => n.id === activeId)
  const database = library.databases.find((d) => d.id === databaseId)
  const visible = library.notes
    .filter(
      (n) =>
        (section === 'trash' ? n.trashed : !n.trashed) &&
        (section === 'favorites'
          ? n.favorite
          : section === 'templates'
            ? n.template
            : section === 'trash' || !n.template) &&
        (!tag || n.tags.includes(tag)) &&
        `${n.title} ${n.body} ${n.tags.join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())
    )
    .sort((a, b) =>
      sort === 'title'
        ? noteTitle(a).localeCompare(noteTitle(b), 'ko')
        : b.updatedAt.localeCompare(a.updatedAt)
    )
  const tags = [
    ...new Set(library.notes.filter((n) => !n.trashed).flatMap((n) => n.tags))
  ].sort()
  const report = (err: unknown) =>
    library.setError(err instanceof Error ? err.message : String(err))
  const open = (id: string) => {
    const note = library.notes.find((n) => n.id === id)
    if (!note) {
      report('연결된 노트를 찾을 수 없습니다.')
      return
    }
    setActiveId(id)
    history.replaceState(null, '', `#note/${id}`)
  }
  useEffect(() => {
    if (!library.loading && !activeId && location.hash.startsWith('#note/')) {
      const id = location.hash.slice(6)
      if (library.notes.some((n) => n.id === id)) setActiveId(id)
    }
  }, [library.loading, library.notes, activeId])
  const back = () => {
    setActiveId(null)
    setFocus(false)
    history.replaceState(null, '', location.pathname)
  }
  const navigate = (next: Section) => {
    setSection(next)
    setQuery('')
    setTag('')
    back()
  }
  const create = async (input: Partial<NoteInput> = {}) => {
    try {
      const note = await library.create(input)
      setActiveId(note.id)
      history.replaceState(null, '', `#note/${note.id}`)
      setNewMenu(false)
    } catch (err) {
      report(err)
    }
  }
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        void library.save()
      }
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setFocus(false)
        search.current?.focus()
      }
      if (e.key.toLowerCase() === 'n' && e.shiftKey) {
        e.preventDefault()
        void create()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })
  async function importFiles(files: FileList | null) {
    if (!files) return
    setBusy(true)
    try {
      for (const file of Array.from(files)) {
        if (file.size > 2_000_000)
          throw new Error(
            `${file.name}: 2MB 이하의 Markdown 파일을 가져오세요.`
          )
        const raw = await file.text(),
          split = splitFrontmatterFile(raw),
          meta = parseYamlData(split.frontmatterRaw)
        const input: Partial<NoteInput> = {
          title:
            typeof meta.title === 'string'
              ? meta.title
              : file.name.replace(/\.(md|markdown|txt)$/i, ''),
          body: split.body,
          tags: Array.isArray(meta.tags)
            ? meta.tags.filter((v): v is string => typeof v === 'string')
            : []
        }
        // Preserve unknown frontmatter verbatim as content, rather than discarding it.
        if (
          split.frontmatterRaw &&
          Object.keys(meta).some((key) => !['title', 'tags'].includes(key))
        )
          input.body = raw
        const note = await library.create(input)
        setActiveId(note.id)
      }
      setSection('notes')
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
      if (importer.current) importer.current.value = ''
    }
  }
  return (
    <div className={`notes-app ${focus ? 'focus-mode' : ''}`}>
      <Header className="app-nav">
        {workspaceSettings && (
          <Modal
            title="워크스페이스 설정"
            description="현재 폴더를 확인하거나 다른 로컬 폴더를 여세요."
            close={() => setWorkspaceSettings(false)}
          >
            <WorkspacePicker
              current={workspace}
              onSelect={async (ws) => {
                if (!(await library.save()))
                  throw new Error('현재 편집본을 저장한 후 폴더를 변경하세요.')
                await selectWorkspace(ws)
                setWorkspaceSettings(false)
              }}
            />
          </Modal>
        )}
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault()
            navigate('notes')
          }}
        >
          <span className="brand-mark">
            <Feather size={19} />
          </span>
          oh-my-maek<span className="version-label">v1</span>
        </a>
        <div className="nav-links">
          {(
            [
              ['notes', BookOpen],
              ['databases', Table2]
            ] as const
          ).map(([value, Icon]) => (
            <Button
              key={value}
              className={
                section === value ||
                (value === 'notes' && section !== 'databases')
                  ? 'active'
                  : ''
              }
              onClick={() => navigate(value)}
            >
              <Icon size={16} />
              {value === 'notes' ? '노트' : '데이터베이스'}
            </Button>
          ))}
        </div>
        <div className="nav-right">
          <span className="local-indicator">
            <i />
            로컬 워크스페이스
          </span>
          <Button
            className="icon-button"
            aria-label={dark ? '라이트 모드' : '다크 모드'}
            onClick={toggleTheme}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </div>
      </Header>
      {library.error && (
        <div className="error-banner" role="alert">
          <span>{library.error}</span>
          <Button onClick={() => void library.save()}>저장 재시도</Button>
          {active && (
            <>
              <Button onClick={() => exportNote(active)}>
                편집본 다운로드
              </Button>
              <Button
                onClick={() => {
                  exportNote(active)
                  void library.reloadNote(active.id).catch(report)
                }}
              >
                편집본 보관 후 새로고침
              </Button>
            </>
          )}
          <Button aria-label="오류 닫기" onClick={() => library.setError('')}>
            <X size={16} />
          </Button>
        </div>
      )}
      <div className="app-body">
        <aside className="note-sidebar">
          <FolderSelector
            name={workspace.name}
            path={workspace.root}
            onClick={() => setWorkspaceSettings(true)}
          />
          <div className="sidebar-heading">
            <h2>{section === 'databases' ? '데이터베이스' : '내 노트'}</h2>
            <Button
              className="icon-button"
              aria-label={
                section === 'databases' ? '새 데이터베이스' : '노트 만들기'
              }
              onClick={() =>
                section === 'databases' ? setDbModal(true) : setNewMenu(true)
              }
            >
              <Plus size={19} />
            </Button>
          </div>
          {section !== 'databases' ? (
            <>
              <label className="search-box">
                <Search size={16} />
                <Input
                  ref={search}
                  aria-label="노트 검색"
                  placeholder="노트 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <kbd>⌘ K</kbd>
              </label>
              <div className="sidebar-filters">
                {(
                  [
                    ['notes', FileText],
                    ['favorites', Star],
                    ['templates', LayoutTemplate],
                    ['trash', Trash2]
                  ] as const
                ).map(([value, Icon]) => (
                  <Button
                    className={section === value ? 'selected' : ''}
                    key={value}
                    onClick={() => navigate(value)}
                  >
                    <Icon size={15} />
                    {labels[value]}
                    <span>
                      {
                        library.notes.filter((n) =>
                          value === 'trash'
                            ? n.trashed
                            : !n.trashed &&
                              (value === 'favorites'
                                ? n.favorite
                                : value === 'templates'
                                  ? n.template
                                  : !n.template)
                        ).length
                      }
                    </span>
                  </Button>
                ))}
              </div>
              <div className="list-heading">
                <span>
                  {query ? '검색 결과' : labels[section]}{' '}
                  <b>{visible.length}</b>
                </span>
                <Select
                  aria-label="노트 정렬"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="updated">최근 수정순</option>
                  <option value="title">이름순</option>
                </Select>
                <ArrowUpDown size={12} />
              </div>
              {tags.length > 0 && (
                <Select
                  className="tag-filter"
                  aria-label="태그 필터"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                >
                  <option value="">모든 태그</option>
                  {tags.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              )}
              <div className="note-list">
                {visible.map((n) => (
                  <Button
                    key={n.id}
                    className={`note-card ${activeId === n.id ? 'active' : ''}`}
                    onClick={() => open(n.id)}
                  >
                    <div className="row">
                      <strong>{noteTitle(n)}</strong>
                      {n.favorite && (
                        <Star
                          size={12}
                          className="starred"
                          fill="currentColor"
                        />
                      )}
                    </div>
                    <p>
                      {n.body
                        .replace(/[#*`>]/g, '')
                        .trim()
                        .slice(0, 95) || '아직 내용이 없습니다.'}
                    </p>
                    <div className="row spread">
                      <time>
                        {new Date(n.updatedAt).toLocaleDateString('ko-KR', {
                          month: 'short',
                          day: 'numeric'
                        })}
                      </time>
                      {n.tags[0] && (
                        <span className="mini-tag">#{n.tags[0]}</span>
                      )}
                    </div>
                  </Button>
                ))}
                {!visible.length && (
                  <p className="empty-small">
                    {query || tag
                      ? '검색 결과가 없습니다.'
                      : '아직 노트가 없습니다.'}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="database-list">
              {library.databases.map((d) => (
                <Button
                  key={d.id}
                  className={d.id === databaseId ? 'active' : ''}
                  onClick={() => {
                    back()
                    setDatabaseId(d.id)
                  }}
                >
                  <Table2 size={16} />
                  {d.name}
                  <span>
                    {
                      library.notes.filter(
                        (n) =>
                          n.databaseId === d.id && !n.trashed && !n.template
                      ).length
                    }
                  </span>
                </Button>
              ))}
              <Button className="text-button" onClick={() => setDbModal(true)}>
                <Plus size={16} />
                데이터베이스 만들기
              </Button>
            </div>
          )}
          <div className="sidebar-bottom">
            <Button
              className="text-button"
              disabled={busy}
              onClick={() => importer.current?.click()}
            >
              <Upload size={15} />
              {busy ? '가져오는 중…' : 'Markdown 가져오기'}
            </Button>
            <Button
              className="icon-button"
              aria-label="전체 백업 다운로드"
              onClick={() =>
                download(
                  'oh-my-maek-backup.json',
                  JSON.stringify(
                    {
                      version: 1,
                      exportedAt: new Date().toISOString(),
                      notes: library.notes,
                      databases: library.databases
                    },
                    null,
                    2
                  ),
                  'application/json'
                )
              }
            >
              <Download size={15} />
            </Button>
            <Input
              hidden
              type="file"
              multiple
              accept=".md,.markdown,.txt"
              ref={importer}
              onChange={(e) => void importFiles(e.target.files)}
            />
          </div>
        </aside>
        <main>
          {library.loading ? (
            <div className="empty-state">
              <span className="empty-icon">
                <BookOpen size={28} />
              </span>
              <h1>노트를 불러오는 중…</h1>
            </div>
          ) : active ? (
            <Editor
              key={active.id}
              note={active}
              notes={library.notes}
              databases={library.databases}
              edit={library.edit}
              create={create}
              open={open}
              back={back}
              saveState={library.saveState}
              focus={focus}
              toggleFocus={() => setFocus(!focus)}
              report={library.setError}
            />
          ) : section === 'databases' && database ? (
            <DatabaseView
              key={database.id}
              database={database}
              notes={library.notes}
              open={open}
              edit={library.edit}
              create={create}
              addField={async (field) => {
                try {
                  await library.addField(database.id, field)
                } catch (err) {
                  report(err)
                  throw err
                }
              }}
            />
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                {section === 'databases' ? (
                  <Table2 size={30} />
                ) : (
                  <Feather size={30} />
                )}
              </span>
              <div className="eyebrow">A QUIET PLACE FOR YOUR IDEAS</div>
              <h1>
                {section === 'databases'
                  ? '노트에 질서를 더하세요.'
                  : section === 'trash'
                    ? '잠시 비워둔 생각들.'
                    : '생각이 머무는 곳.'}
              </h1>
              <p>
                {section === 'databases'
                  ? '노트를 표와 보드로 모아보세요.\n작은 프로젝트부터 나만의 자료실까지.'
                  : section === 'trash'
                    ? '왼쪽에서 노트를 열어 복원할 수 있습니다.'
                    : '떠오른 생각, 오늘의 기록, 다음에 할 일.\n한 장의 노트에서 시작해보세요.'}
              </p>
              <Button
                className="primary large"
                onClick={() =>
                  section === 'databases' ? setDbModal(true) : setNewMenu(true)
                }
              >
                <Plus size={18} />
                {section === 'databases'
                  ? '데이터베이스 만들기'
                  : '새 노트 쓰기'}
              </Button>
              {section !== 'databases' && (
                <Button
                  className="text-button guide-link"
                  onClick={() => void create(welcome)}
                >
                  시작 가이드 열기 <span>↗</span>
                </Button>
              )}
              <div className="empty-footnote">
                내 컴퓨터에 저장 · 계정 없이 시작 · Markdown으로 보관
              </div>
            </div>
          )}
        </main>
      </div>
      {newMenu && (
        <Modal
          title="새 노트"
          description="빈 페이지에서 시작하거나, 자주 쓰는 틀을 골라보세요."
          close={() => setNewMenu(false)}
        >
          <Button className="picker-item" onClick={() => void create()}>
            <Plus size={18} />
            <strong>빈 노트</strong>
          </Button>
          {builtins.map((t) => (
            <Button
              className="picker-item"
              key={t.title}
              onClick={() =>
                void create({
                  ...t,
                  title:
                    t.title === '오늘의 노트'
                      ? new Date().toLocaleDateString('sv-SE')
                      : t.title
                })
              }
            >
              <LayoutTemplate size={18} />
              {t.title}
            </Button>
          ))}
          {library.notes
            .filter((n) => n.template && !n.trashed)
            .map((n) => (
              <Button
                className="picker-item"
                key={n.id}
                onClick={() =>
                  void create({
                    ...n,
                    template: false,
                    favorite: false,
                    title: `${noteTitle(n)} 사본`
                  })
                }
              >
                <FileText size={18} />
                {noteTitle(n)}
              </Button>
            ))}
        </Modal>
      )}
      {dbModal && (
        <Modal
          title="새 데이터베이스"
          description="노트를 모아 표와 보드로 관리하세요. 속성은 나중에 추가할 수 있습니다."
          close={() => setDbModal(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setBusy(true)
              void library
                .createDatabase(dbName.trim())
                .then((db) => {
                  setDatabaseId(db.id)
                  navigate('databases')
                  setDbModal(false)
                  setDbName('')
                })
                .catch(report)
                .finally(() => setBusy(false))
            }}
          >
            <label>
              이름
              <Input
                required
                maxLength={120}
                placeholder="예: 프로젝트, 읽을거리, 아이디어"
                value={dbName}
                onChange={(e) => setDbName(e.target.value)}
              />
            </label>
            <Button
              type="submit"
              disabled={busy || !dbName.trim()}
              className="primary"
            >
              만들기
            </Button>
          </form>
        </Modal>
      )}
    </div>
  )
}
