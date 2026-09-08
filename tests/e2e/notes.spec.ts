import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test.beforeEach(async ({ page }) => {
  const root = mkdtempSync(path.join(tmpdir(), 'maek-e2e-workspace-'))
  await page.goto('/')
  await page.getByRole('button', { name: '경로 직접 입력' }).click()
  await page.getByRole('textbox', { name: '워크스페이스 경로' }).fill(root)
  await page.getByRole('button', { name: '폴더 열기', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '노트 만들기', exact: true })
  ).toBeVisible()
})

async function newNote(page: Page, title: string, body: string) {
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click()
  await page.getByRole('button', { name: '빈 노트', exact: true }).click()
  await page
    .getByRole('textbox', { name: '노트 제목', exact: true })
    .fill(title)
  await page.getByRole('textbox', { name: '노트 본문', exact: true }).fill(body)
  await expect(page.getByRole('status')).toHaveText('저장됨')
}

test('Korean editing, formatting, navigation, search, trash, history, export and reload', async ({
  page
}) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/')
  await newNote(
    page,
    '한글로 기록한 하루',
    '## 오늘의 기록\n\n한글 입력과 **굵은 글씨**\n\n- [ ] 할 일\n\n| 이름 | 내용 |\n| --- | --- |\n| 첫 번째 | 기록 |\n\n수식: $x^2$'
  )
  await page.getByRole('textbox', { name: '태그 추가' }).fill('일상')
  await page.getByRole('textbox', { name: '태그 추가' }).press('Enter')
  await page.getByRole('button', { name: '즐겨찾기', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await page.getByRole('button', { name: '읽기', exact: true }).click()
  await expect(page.getByRole('heading', { name: '오늘의 기록' })).toBeVisible()
  await expect(page.locator('.markdown-preview table')).toBeVisible()
  await expect(page.locator('.katex')).toBeVisible()
  await page.screenshot({
    path: 'test-results/note-desktop.png',
    fullPage: true
  })
  await page.reload()
  await expect(page.getByRole('textbox', { name: '노트 제목' })).toHaveValue(
    '한글로 기록한 하루'
  )
  await expect(page.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    /한글 입력/
  )
  await page.getByRole('textbox', { name: '노트 본문' }).fill('새로운 버전')
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await page.getByRole('button', { name: '버전 기록' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '내용 복원' }).first().click()
  await expect(page.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    /한글 입력/
  )
  await expect(page.getByRole('status')).toHaveText('저장됨')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Markdown 내보내기' }).click()
  expect((await download).suggestedFilename()).toBe('한글로 기록한 하루.md')
  await page.getByRole('button', { name: '휴지통으로 이동' }).click()
  await expect(
    page.getByRole('textbox', { name: '노트 본문' })
  ).toHaveAttribute('readonly', '')
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await page.getByRole('button', { name: '노트 복원', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await page
    .getByRole('textbox', { name: '노트 검색', exact: true })
    .fill('존재하지않는검색어')
  await expect(page.getByText('검색 결과가 없습니다.')).toBeVisible()
  await page
    .getByRole('textbox', { name: '노트 검색', exact: true })
    .fill('한글')
  await expect(page.locator('.note-card')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('database table, custom fields, board status and persistence', async ({
  page
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: '데이터베이스', exact: true }).click()
  await page
    .getByRole('button', { name: '새 데이터베이스', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: '이름', exact: true })
    .fill('제품 만들기')
  await page.getByRole('button', { name: '만들기', exact: true }).click()
  await page.getByRole('button', { name: '속성 추가', exact: true }).click()
  await page.getByRole('textbox', { name: '속성 이름' }).fill('예상 시간')
  await page
    .getByRole('combobox', { name: '속성 유형', exact: true })
    .selectOption('number')
  await page.getByRole('button', { name: '추가', exact: true }).click()
  await expect(
    page.getByRole('columnheader', { name: '예상 시간' })
  ).toBeVisible()
  await page.getByRole('button', { name: '새 행', exact: true }).click()
  await page
    .getByRole('textbox', { name: '노트 제목' })
    .fill('노트 에디터 완성하기')
  await page
    .getByRole('textbox', { name: '노트 본문' })
    .fill('단순하고 편안한 글쓰기 경험을 만든다.')
  await page.getByRole('spinbutton', { name: '예상 시간' }).fill('4')
  await page.getByRole('spinbutton', { name: '예상 시간' }).press('Tab')
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await page.getByRole('button', { name: '목록으로' }).click()
  await expect(page.getByRole('spinbutton', { name: '예상 시간' })).toHaveValue(
    '4'
  )
  await page
    .getByRole('combobox', { name: '노트 에디터 완성하기 상태' })
    .selectOption('진행 중')
  await page.getByRole('button', { name: '보드', exact: true }).click()
  await expect(
    page
      .locator('.board-column')
      .nth(1)
      .getByRole('button', { name: '노트 에디터 완성하기' })
  ).toBeVisible()
  await page.screenshot({
    path: 'test-results/database-board.png',
    fullPage: true
  })
  await page.getByRole('button', { name: '노트 에디터 완성하기' }).click()
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await page.reload()
  await expect(page.getByRole('combobox', { name: '노트 상태' })).toHaveValue(
    '진행 중'
  )
  await expect(page.getByRole('spinbutton', { name: '예상 시간' })).toHaveValue(
    '4'
  )
})

test('keeps edits while switching notes and recovers drafts after a failed save', async ({
  page
}) => {
  await page.goto('/')
  await newNote(page, '저장 복구 테스트', '처음 내용')
  await page.route('**/api/notes/*', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue()
  )
  await page
    .getByRole('textbox', { name: '노트 본문' })
    .fill('네트워크가 끊겨도 유지할 편집본')
  await expect(page.getByRole('status')).toHaveText('저장 실패')
  page.on('dialog', (dialog) => dialog.accept())
  await page.reload()
  await expect(page.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    '네트워크가 끊겨도 유지할 편집본'
  )
  await page.unroute('**/api/notes/*')
  await page
    .getByRole('textbox', { name: '노트 본문' })
    .fill('다시 연결된 편집본')
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await page
    .getByRole('textbox', { name: '노트 본문' })
    .fill('전환 직전 마지막 내용')
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click()
  await page.getByRole('button', { name: '빈 노트', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await page
    .locator('.note-card')
    .filter({ hasText: '저장 복구 테스트' })
    .click()
  await expect(page.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    '전환 직전 마지막 내용'
  )
})

test('mobile editor and dark mode fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await newNote(page, '모바일 메모', '작은 화면에서도 글을 씁니다.')
  await page.getByRole('button', { name: '다크 모드', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '노트 본문' })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  await page.screenshot({
    path: 'test-results/note-mobile-dark.png',
    fullPage: true
  })
})

test('note links, backlinks, templates, Markdown import and native formatting', async ({
  page
}) => {
  await page.goto('/')
  await newNote(page, '연결 대상', '참고할 내용')
  await newNote(page, '연결 출발점', '참고: ')
  await page.getByRole('button', { name: '노트 연결', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '연결 대상', exact: true })
    .click()
  await expect(page.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    /\[연결 대상\]\(#note\//
  )
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await page.getByRole('button', { name: '읽기', exact: true }).click()
  await page.getByRole('link', { name: '연결 대상', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '노트 제목' })).toHaveValue(
    '연결 대상'
  )
  await expect(
    page.locator('.backlinks').getByRole('button', { name: '연결 출발점' })
  ).toBeVisible()
  await page.getByRole('textbox', { name: '노트 본문' }).focus()
  await page
    .getByRole('textbox', { name: '노트 본문' })
    .press('ControlOrMeta+a')
  await page.getByRole('button', { name: '굵게', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    '**참고할 내용**'
  )
  await page
    .getByRole('textbox', { name: '노트 본문' })
    .press('ControlOrMeta+z')
  await expect(page.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    '참고할 내용'
  )
  await page
    .getByRole('button', { name: '템플릿으로 지정', exact: true })
    .click()
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await page.getByRole('button', { name: '노트 만들기', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '연결 대상', exact: true })
    .click()
  await expect(page.getByRole('textbox', { name: '노트 제목' })).toHaveValue(
    '연결 대상 사본'
  )
  await page.locator('input[type=file]').setInputFiles({
    name: '가져온 노트.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '---\ntitle: 파일에서 가져오기\ntags: [자료]\n---\n\n본문 보존 확인\n'
    )
  })
  await expect(page.getByRole('textbox', { name: '노트 제목' })).toHaveValue(
    '파일에서 가져오기'
  )
  await expect(page.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    '본문 보존 확인\n'
  )
})

test('concurrent browser edits cannot silently overwrite the saved note', async ({
  page,
  context
}) => {
  await page.goto('/')
  await newNote(page, '동시 편집', '원본')
  const second = await context.newPage()
  await second.goto(page.url())
  await expect(second.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    '원본'
  )
  await page
    .getByRole('textbox', { name: '노트 본문' })
    .fill('첫 번째 창의 수정')
  await expect(page.getByRole('status')).toHaveText('저장됨')
  await second
    .getByRole('textbox', { name: '노트 본문' })
    .fill('두 번째 창의 수정')
  await expect(second.getByRole('status')).toHaveText('저장 실패')
  await expect(second.getByRole('alert')).toContainText('다른 창')
  await expect(second.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    '두 번째 창의 수정'
  )
  const exported = second.waitForEvent('download')
  await second.getByRole('button', { name: '편집본 보관 후 새로고침' }).click()
  await exported
  await expect(second.getByRole('textbox', { name: '노트 본문' })).toHaveValue(
    '첫 번째 창의 수정'
  )
  await second.close()
})
