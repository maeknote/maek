import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode
} from 'react'
import './css/variables.css'
import './css/effects.css'
import './system.css'
const Theme = createContext({ dark: false, toggle: () => {} })
export const useTheme = () => useContext(Theme)
export function DesignProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('oh-my-maek:v1:theme') === 'dark'
    } catch {
      return false
    }
  })
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try {
      localStorage.setItem('oh-my-maek:v1:theme', dark ? 'dark' : 'light')
    } catch {
      /* Theme still works without storage. */
    }
  }, [dark])
  return (
    <Theme.Provider value={{ dark, toggle: () => setDark((value) => !value) }}>
      {children}
    </Theme.Provider>
  )
}
