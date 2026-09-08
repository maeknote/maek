import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../server/app'

const roots: string[] = []
const temporary = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'maek-workspace-test-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

it('isolates reads, writes and history by selected workspace and restores from a path', async () => {
  const defaultRoot = temporary(),
    first = temporary(),
    second = temporary()
  let app = createApp(defaultRoot)
  const open = async (root: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/workspaces/open',
        payload: { path: root }
      })
    ).json()
  const a = await open(first),
    b = await open(second)
  const headers = { 'x-workspace-id': a.wsId }
  const note = (
    await app.inject({
      method: 'POST',
      url: '/api/notes',
      headers,
      payload: { title: 'first only' }
    })
  ).json()
  expect(
    (
      await app.inject({
        url: '/api/library',
        headers: { 'x-workspace-id': b.wsId }
      })
    ).json().notes
  ).toEqual([])
  expect((await app.inject({ url: '/api/library' })).json().notes).toEqual([])
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/notes/${note.id}`,
        headers: { 'x-workspace-id': b.wsId },
        payload: { ...note, title: 'wrong root' }
      })
    ).statusCode
  ).toBe(404)
  expect(
    (
      await app.inject({
        url: `/api/notes/${note.id}/history`,
        headers: { 'x-workspace-id': b.wsId }
      })
    ).statusCode
  ).toBe(404)
  await app.close()
  app = createApp(defaultRoot)
  const restored = await open(first)
  expect(
    (
      await app.inject({
        url: '/api/library',
        headers: { 'x-workspace-id': restored.wsId }
      })
    ).json().notes[0].title
  ).toBe('first only')
  expect(
    (
      await app.inject({
        url: '/api/library',
        headers: { 'x-workspace-id': 'unknown' }
      })
    ).statusCode
  ).toBe(404)
  await app.close()
})

it('rejects invalid roots and cross-origin folder picker requests before OS interaction', async () => {
  const app = createApp(temporary())
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/workspaces/open',
        payload: { path: 'relative/path' }
      })
    ).statusCode
  ).toBe(400)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/workspaces/open',
        payload: { path: '/missing-maek-root' }
      })
    ).statusCode
  ).toBe(404)
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/workspaces/pick',
        headers: { origin: 'https://other.example' }
      })
    ).statusCode
  ).toBe(403)
  await app.close()
})
