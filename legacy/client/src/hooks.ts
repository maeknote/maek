import { useEffect, useState } from 'react'

/**
 * True only after `delay` ms of continuous truth. Loading states below the
 * threshold never render, so a fast local read does not flash a skeleton
 * (design: >150ms 스켈레톤).
 */
export function useDelayed(value: boolean, delay = 150): boolean {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!value) {
      setShown(false)
      return
    }
    const timer = window.setTimeout(() => setShown(true), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return shown
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** Breakpoints from the design's 반응형 section — window sizing only, no mobile. */
export function useBreakpoint(): 'wide' | 'medium' | 'narrow' | 'unsupported' {
  const overWide = useMediaQuery('(min-width: 1100px)')
  const overMedium = useMediaQuery('(min-width: 900px)')
  const overMin = useMediaQuery('(min-width: 600px)')

  if (overWide) return 'wide'
  if (overMedium) return 'medium'
  if (overMin) return 'narrow'
  return 'unsupported'
}
