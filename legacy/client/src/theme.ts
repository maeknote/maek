export type ThemePref = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'oh-my-maek:theme'

export function getThemePref(): ThemePref {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

/**
 * `system` removes the attribute entirely so the prefers-color-scheme media
 * query in tokens.css takes over — that is the default (design: 시스템 설정
 * 따라가기 기본). Without this the [data-theme] tokens never apply and a user
 * on a dark system gets a white page.
 */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement
  if (pref === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', pref)
  localStorage.setItem(STORAGE_KEY, pref)
}

export function initTheme(): void {
  const pref = getThemePref()
  if (pref !== 'system') document.documentElement.setAttribute('data-theme', pref)
}

/** system → light → dark → system */
export function cycleTheme(): ThemePref {
  const next: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
  const pref = next[getThemePref()]
  applyTheme(pref)
  return pref
}
