import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('workspace selection, external changes, switching, restore, and theme tokens', async ({
  page
}) => {
  const first = mkdtempSync(path.join(tmpdir(), 'maek-workspace-a-'))
  const second = mkdtempSync(path.join(tmpdir(), 'maek-workspace-b-'))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '워크스페이스 열기' })
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/workspace-startup.png' })
  // Mock only the OS dialog boundary; registration, persistence, storage and
  // event-driven filesystem refresh all use the real local server.
  await page.route('**/api/workspaces/pick', async (route) => {
    const response = await page.request.post('/api/workspaces/open', {
      data: { path: first }
    })
    await route.fulfill({
      json: { status: 'ok', workspace: await response.json() }
    })
  })
  await page.getByRole('button', { name: '폴더 선택', exact: true }).click()
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click()
  await page.getByRole('button', { name: '빈 노트', exact: true }).click()
  await page
    .getByRole('textbox', { name: '노트 제목' })
    .fill('워크스페이스 노트')
  await page.getByRole('textbox', { name: '노트 본문' }).fill('external-before')
  await expect(page.getByRole('status')).toHaveText('저장됨')
  const file = path.join(
    first,
    'notes',
    readdirSync(path.join(first, 'notes')).find((n) => n.endsWith('.md'))!
  )
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('external-before', 'external-after')
  )
  await expect(page.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    'external-after'
  )
  expect(
    await page
      .locator('html')
      .evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--color-maek-red').trim()
      )
  ).toBe('#C04E3E')
  await page.screenshot({ path: 'test-results/workspace-editor-light.png' })
  await page.getByRole('button', { name: '다크 모드' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('.note-card')).toHaveCSS(
    'color',
    'rgb(232, 230, 227)'
  )
  await page.screenshot({ path: 'test-results/workspace-editor-dark.png' })
  await page
    .getByRole('button', { name: path.basename(first), exact: true })
    .click()
  await page.getByRole('button', { name: '경로 직접 입력' }).click()
  await page.getByRole('textbox', { name: '워크스페이스 경로' }).fill(second)
  await page.getByRole('button', { name: '폴더 열기', exact: true }).click()
  await expect(page.locator('.note-list')).not.toContainText(
    '워크스페이스 노트'
  )
  await page.reload()
  await expect(
    page.getByRole('button', { name: path.basename(second), exact: true })
  ).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page
    .getByRole('button', { name: path.basename(second), exact: true })
    .click()
  await page.getByRole('button', { name: '경로 직접 입력' }).click()
  await page.getByRole('textbox', { name: '워크스페이스 경로' }).fill(first)
  await page.getByRole('button', { name: '폴더 열기', exact: true }).click()
  await expect(page.locator('.note-list')).toContainText('워크스페이스 노트')
})

test('native cancel, unavailable picker, and missing persisted folder remain recoverable', async ({
  page
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('oh-my-maek:workspace', '/nonexistent-maek-workspace')
  )
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText(
    '이전 폴더를 열지 못했습니다'
  )
  await page.route('**/api/workspaces/pick', (route) =>
    route.fulfill({ json: { status: 'canceled' } })
  )
  await page.getByRole('button', { name: '폴더 선택', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '폴더 선택', exact: true })
  ).toBeEnabled()
  await page.route('**/api/workspaces/pick', (route) =>
    route.fulfill({ json: { status: 'fallback', reason: 'headless' } })
  )
  await page.getByRole('button', { name: '폴더 선택', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: '워크스페이스 경로' })
  ).toBeVisible()
})
