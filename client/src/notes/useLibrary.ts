import { useCallback, useEffect, useRef, useState } from 'react'
import {
  noteSchema,
  type Library,
  type Note,
  type NoteInput,
  type Database,
  type Field
} from '@shared/notes'
import { request } from './api'

const DRAFT_KEY = 'oh-my-maek:v1:drafts'
export function useLibrary() {
  const [draftKey] = useState(() => {
    // Each browser tab owns its recovery draft; a successful save in another
    // tab must never erase an unsaved/conflicting draft here.
    try {
      let tab = sessionStorage.getItem('oh-my-maek:v1:tab')
      if (!tab) {
        tab = crypto.randomUUID()
        sessionStorage.setItem('oh-my-maek:v1:tab', tab)
      }
      return `${DRAFT_KEY}:${tab}`
    } catch {
      return DRAFT_KEY
    }
  })
  const [data, setData] = useState<Library>({ notes: [], databases: [] })
  const current = useRef(data)
  const dirty = useRef(new Set<string>())
  const saving = useRef<Promise<boolean> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('저장됨')
  const publish = useCallback((next: Library) => {
    current.current = next
    setData(next)
  }, [])
  const backup = useCallback(() => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify(
          current.current.notes.filter((n) => dirty.current.has(n.id))
        )
      )
    } catch {
      setError(
        '브라우저에 임시 편집본을 보관하지 못했습니다. 서버 저장 상태를 확인하세요.'
      )
    }
  }, [draftKey])
  const refresh = useCallback(async () => {
    const before = current.current
    const remote = await request<Library>('/api/library')
    if (current.current !== before) return
    publish({
      ...remote,
      notes: remote.notes.map((n) =>
        dirty.current.has(n.id)
          ? (current.current.notes.find((d) => d.id === n.id) ?? n)
          : n
      )
    })
  }, [publish])
  useEffect(() => {
    let active = true
    void request<Library>('/api/library')
      .then((remote) => {
        if (!active) return
        try {
          const cached = JSON.parse(
            localStorage.getItem(draftKey) ?? '[]'
          ) as unknown[]
          for (const raw of cached) {
            const parsed = noteSchema.safeParse(raw)
            if (!parsed.success) continue
            const draft = parsed.data
            const index = remote.notes.findIndex((n) => n.id === draft.id)
            if (index !== -1) {
              remote.notes[index] = draft
              dirty.current.add(draft.id)
            }
          }
        } catch {
          /* An unreadable browser cache never prevents loading disk notes. */
        }
        publish(remote)
        if (dirty.current.size) setSaveState('복구된 편집본 저장 대기')
      })
      .catch((err) => active && setError(String(err.message)))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [publish, draftKey])
  const edit = useCallback(
    (id: string, patch: Partial<NoteInput>) => {
      dirty.current.add(id)
      publish({
        ...current.current,
        notes: current.current.notes.map((n) =>
          n.id === id ? { ...n, ...patch } : n
        )
      })
      setSaveState('저장 대기')
      backup()
    },
    [publish, backup]
  )
  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) return saving.current
    if (!dirty.current.size) return true
    const work = async () => {
      try {
        while (dirty.current.size) {
          const id = [...dirty.current][0]!
          const snapshot = current.current.notes.find((n) => n.id === id)
          if (!snapshot) {
            dirty.current.delete(id)
            continue
          }
          setSaveState('저장 중…')
          const result = await request<Note>(
            `/api/notes/${id}`,
            'PUT',
            snapshot
          )
          const latest = current.current.notes.find((n) => n.id === id)
          if (latest === snapshot) dirty.current.delete(id)
          publish({
            ...current.current,
            notes: current.current.notes.map((n) =>
              n.id === id
                ? {
                    ...n,
                    revision: result.revision,
                    updatedAt: result.updatedAt
                  }
                : n
            )
          })
          backup()
        }
        setSaveState('저장됨')
        setError('')
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : '저장 실패')
        setSaveState('저장 실패')
        return false
      } finally {
        saving.current = null
      }
    }
    saving.current = work()
    return saving.current
  }, [publish, backup])
  useEffect(() => {
    if (!dirty.current.size || saveState === '저장 실패') return
    const timer = setTimeout(() => void save(), 700)
    return () => clearTimeout(timer)
  }, [data, save, saveState])
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        e.preventDefault()
        backup()
      }
    }
    const focus = () => {
      void refresh().catch((err) => setError(err.message))
    }
    window.addEventListener('beforeunload', unload)
    window.addEventListener('focus', focus)
    return () => {
      window.removeEventListener('beforeunload', unload)
      window.removeEventListener('focus', focus)
    }
  }, [refresh, backup])
  const create = async (input: Partial<NoteInput> = {}) => {
    const note = await request<Note>('/api/notes', 'POST', input)
    publish({ ...current.current, notes: [note, ...current.current.notes] })
    return note
  }
  const createDatabase = async (name: string) => {
    const database = await request<Database>('/api/databases', 'POST', {
      name,
      fields: []
    })
    publish({
      ...current.current,
      databases: [...current.current.databases, database]
    })
    return database
  }
  const addField = async (id: string, field: Field) => {
    const database = await request<Database>(
      `/api/databases/${id}/fields`,
      'POST',
      field
    )
    publish({
      ...current.current,
      databases: current.current.databases.map((d) =>
        d.id === id ? database : d
      )
    })
  }
  const reloadNote = async (id: string) => {
    const remote = await request<Library>('/api/library')
    const note = remote.notes.find((n) => n.id === id)
    if (!note) throw new Error('노트를 찾을 수 없습니다.')
    dirty.current.delete(id)
    publish({
      ...current.current,
      notes: current.current.notes.map((n) => (n.id === id ? note : n))
    })
    backup()
    setError('')
    setSaveState(dirty.current.size ? '저장 대기' : '저장됨')
  }
  return {
    ...data,
    loading,
    error,
    setError,
    saveState,
    edit,
    save,
    create,
    createDatabase,
    addField,
    refresh,
    reloadNote
  }
}
