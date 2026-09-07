import { useState } from 'react'
import {
  Columns3,
  Table2,
  Plus,
  FileText,
  Download,
  ArrowUpDown
} from 'lucide-react'
import {
  noteTitle,
  statusSchema,
  type Note,
  type NoteInput,
  type Database,
  type Field
} from '@shared/notes'
import { PropertyInput } from './PropertyInput'
import { Modal } from './Modal'
import { download } from './api'

export function DatabaseView({
  database,
  notes,
  open,
  edit,
  create,
  addField
}: {
  database: Database
  notes: Note[]
  open: (id: string) => void
  edit: (id: string, patch: Partial<NoteInput>) => void
  create: (input: Partial<NoteInput>) => Promise<void>
  addField: (field: Field) => Promise<void>
}) {
  const [view, setView] = useState<'table' | 'board'>('table')
  const [filter, setFilter] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState(false)
  const [fieldModal, setFieldModal] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<Field['type']>('text')
  const [options, setOptions] = useState('')
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState('')
  const rows = notes
    .filter(
      (n) =>
        n.databaseId === database.id &&
        !n.trashed &&
        !n.template &&
        (!status || n.status === status) &&
        `${n.title} ${n.body} ${n.tags.join(' ')}`
          .toLowerCase()
          .includes(filter.toLowerCase())
    )
    .sort((a, b) =>
      sort
        ? noteTitle(a).localeCompare(noteTitle(b), 'ko')
        : b.updatedAt.localeCompare(a.updatedAt)
    )
  function exportCsv() {
    const cell = (value: unknown) => {
      const raw = String(value ?? '')
      return `"${(/^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw).replace(/"/g, '""')}"`
    }
    const values = [
      ['이름', '상태', '태그', ...database.fields.map((f) => f.name)],
      ...rows.map((n) => [
        noteTitle(n),
        n.status,
        n.tags.join(', '),
        ...database.fields.map((f) => n.properties[f.id])
      ])
    ]
    download(
      `${database.name}.csv`,
      '\uFEFF' + values.map((row) => row.map(cell).join(',')).join('\r\n'),
      'text/csv'
    )
  }
  return (
    <section className="database-pane">
      <header className="database-heading">
        <div className="eyebrow">A LITTLE STRUCTURE, MORE CLARITY</div>
        <h1>
          <Table2 size={30} />
          {database.name}
        </h1>
        <p>
          생각을 모으고, 진행 상황을 한눈에 살펴보세요. 모든 행은 하나의
          노트입니다.
        </p>
      </header>
      <div className="database-toolbar">
        <div className="segmented">
          <button
            className={view === 'table' ? 'selected' : ''}
            onClick={() => setView('table')}
          >
            <Table2 size={15} />표
          </button>
          <button
            className={view === 'board' ? 'selected' : ''}
            onClick={() => setView('board')}
          >
            <Columns3 size={15} />
            보드
          </button>
        </div>
        <span className="muted">{rows.length}개 노트</span>
        <div className="spacer" />
        <button className="secondary" onClick={exportCsv}>
          <Download size={15} />
          CSV
        </button>
        <button
          className="primary"
          onClick={() => void create({ databaseId: database.id })}
        >
          <Plus size={16} />새 행
        </button>
      </div>
      <div className="database-filters">
        <input
          aria-label="데이터베이스 검색"
          placeholder="노트 검색…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          aria-label="상태 필터"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">모든 상태</option>
          {statusSchema.options.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="text-button" onClick={() => setSort(!sort)}>
          <ArrowUpDown size={14} />
          {sort ? '이름순' : '최근 수정순'}
        </button>
      </div>
      {view === 'table' ? (
        <div className="table-scroll">
          <table className="database-table">
            <thead>
              <tr>
                <th className="title-cell">이름</th>
                <th>상태</th>
                <th>태그</th>
                {database.fields.map((f) => (
                  <th key={f.id}>{f.name}</th>
                ))}
                <th>
                  <button
                    className="text-button"
                    onClick={() => setFieldModal(true)}
                  >
                    <Plus size={14} />
                    속성 추가
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id}>
                  <td>
                    <button className="row-title" onClick={() => open(n.id)}>
                      <FileText size={15} />
                      {noteTitle(n)}
                    </button>
                  </td>
                  <td>
                    <select
                      aria-label={`${noteTitle(n)} 상태`}
                      className={`status-select status-${statusSchema.options.indexOf(n.status)}`}
                      value={n.status}
                      onChange={(e) =>
                        edit(n.id, {
                          status: statusSchema.parse(e.target.value)
                        })
                      }
                    >
                      {statusSchema.options.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className="muted">
                      {n.tags.map((t) => `#${t}`).join(' ') || '—'}
                    </span>
                  </td>
                  {database.fields.map((f) => (
                    <td key={f.id}>
                      <PropertyInput
                        field={f}
                        value={n.properties[f.id]}
                        change={(value) =>
                          edit(n.id, {
                            properties: { ...n.properties, [f.id]: value }
                          })
                        }
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="empty-small">
              아직 표시할 노트가 없습니다. 새 행으로 시작해보세요.
            </div>
          )}
          <button
            className="add-row"
            onClick={() => void create({ databaseId: database.id })}
          >
            <Plus size={15} />새 노트 추가
          </button>
        </div>
      ) : (
        <div className="board">
          {statusSchema.options.map((s, index) => (
            <section
              className="board-column"
              key={s}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain')
                if (rows.some((n) => n.id === id)) edit(id, { status: s })
              }}
            >
              <header>
                <span className={`status-dot status-${index}`} />
                {s}
                <span className="count">
                  {rows.filter((n) => n.status === s).length}
                </span>
              </header>
              {rows
                .filter((n) => n.status === s)
                .map((n) => (
                  <article
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData('text/plain', n.id)
                    }
                    className="board-card"
                    key={n.id}
                  >
                    <button onClick={() => open(n.id)}>
                      <FileText size={16} />
                      <strong>{noteTitle(n)}</strong>
                    </button>
                    <p>
                      {n.body.replace(/[#*`>]/g, '').slice(0, 100) ||
                        '아직 내용이 없습니다.'}
                    </p>
                    <div className="row spread">
                      <span className="muted">
                        {n.tags[0] ? `#${n.tags[0]}` : '노트'}
                      </span>
                      <select
                        aria-label={`${noteTitle(n)} 상태`}
                        value={n.status}
                        onChange={(e) =>
                          edit(n.id, {
                            status: statusSchema.parse(e.target.value)
                          })
                        }
                      >
                        {statusSchema.options.map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  </article>
                ))}
              <button
                className="add-row"
                onClick={() =>
                  void create({ databaseId: database.id, status: s })
                }
              >
                <Plus size={15} />새 노트
              </button>
            </section>
          ))}
        </div>
      )}
      {fieldModal && (
        <Modal
          title="속성 추가"
          description="노트에 기록할 정보를 추가하세요. 기본 상태 속성으로 보드를 구성합니다."
          close={() => setFieldModal(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setBusy(true)
              setFieldError('')
              void addField({
                id: crypto.randomUUID(),
                name: name.trim(),
                type,
                options:
                  type === 'select'
                    ? [
                        ...new Set(
                          options
                            .split(',')
                            .map((v) => v.trim())
                            .filter(Boolean)
                        )
                      ]
                    : []
              })
                .then(() => {
                  setFieldModal(false)
                  setName('')
                })
                .catch((err) =>
                  setFieldError(
                    err instanceof Error
                      ? err.message
                      : '속성을 추가하지 못했습니다.'
                  )
                )
                .finally(() => setBusy(false))
            }}
          >
            <label>
              속성 이름
              <input
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 마감일"
              />
            </label>
            <label>
              유형
              <select
                aria-label="속성 유형"
                value={type}
                onChange={(e) => setType(e.target.value as Field['type'])}
              >
                <option value="text">텍스트</option>
                <option value="number">숫자</option>
                <option value="date">날짜</option>
                <option value="checkbox">체크박스</option>
                <option value="select">선택</option>
              </select>
            </label>
            {type === 'select' && (
              <label>
                선택 항목
                <input
                  required
                  placeholder="낮음, 보통, 높음"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                />
              </label>
            )}
            {fieldError && <p role="alert">{fieldError}</p>}
            <button className="primary" disabled={busy || !name.trim()}>
              추가
            </button>
          </form>
        </Modal>
      )}
    </section>
  )
}
