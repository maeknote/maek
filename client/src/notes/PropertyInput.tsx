import { useEffect, useState } from 'react'
import type { Field, Note } from '@shared/notes'

export function PropertyInput({
  field,
  value,
  change,
  disabled = false
}: {
  field: Field
  value: Note['properties'][string] | undefined
  change: (value: Note['properties'][string]) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(String(value ?? ''))
  useEffect(() => setDraft(String(value ?? '')), [value])
  if (field.type === 'checkbox')
    return (
      <input
        aria-label={field.name}
        disabled={disabled}
        type="checkbox"
        checked={value === true}
        onChange={(e) => change(e.target.checked)}
      />
    )
  if (field.type === 'select')
    return (
      <select
        aria-label={field.name}
        disabled={disabled}
        value={String(value ?? '')}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">미지정</option>
        {field.options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    )
  return (
    <input
      aria-label={field.name}
      disabled={disabled}
      type={field.type === 'text' ? 'text' : field.type}
      value={draft}
      maxLength={2000}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next =
          field.type === 'number'
            ? draft === ''
              ? null
              : Number(draft)
            : draft
        if (typeof next === 'number' && !Number.isFinite(next)) {
          setDraft(String(value ?? ''))
          return
        }
        if (next !== value) change(next)
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}
