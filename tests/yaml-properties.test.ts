import { describe, expect, it } from 'vitest'
import { parseYamlData } from '@shared/frontmatter'
import {
  parseYamlToProperties,
  serializePropertiesToYaml,
} from '../client/src/features/editor/utils/yamlProperties'

describe('YAML properties editor', () => {
  it('keeps object-valued properties when a scalar property is changed', () => {
    const raw = [
      'Status: Todo',
      'Period:',
      '  start: 2026-09-14',
      '  end: 2026-09-18',
      'Notes: Original',
    ].join('\n')
    const parsed = parseYamlToProperties(raw)
    const changed = parsed.properties.map((property) =>
      property.key === 'Notes' ? { ...property, value: 'Edited' } : property,
    )

    expect(parseYamlData(serializePropertiesToYaml(changed, raw))).toEqual({
      Status: 'Todo',
      Period: { start: '2026-09-14', end: '2026-09-18' },
      Notes: 'Edited',
    })
  })

  it('preserves untouched YAML types, scalar styles, and comments', () => {
    const raw = [
      'Status: "Todo" # keep the quote and comment',
      'Tags:',
      '  - one',
      '  - 2',
      'Window: { start: 2026-09-14, end: 2026-09-18 }',
      'Enabled: true',
    ].join('\n')
    const parsed = parseYamlToProperties(raw)
    const changed = parsed.properties.map((property) =>
      property.key === 'Status' ? { ...property, value: 'Doing' } : property,
    )
    const serialized = serializePropertiesToYaml(changed, raw)

    expect(serialized).toContain('Status: "Doing" # keep the quote and comment')
    expect(parseYamlData(serialized)).toEqual({
      Status: 'Doing',
      Tags: ['one', 2],
      Window: { start: '2026-09-14', end: '2026-09-18' },
      Enabled: true,
    })
  })
})
