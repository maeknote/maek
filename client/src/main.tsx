import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './notes/NotesApp'
import { DesignProvider } from './design/DesignProvider'
import { WorkspaceProvider } from './Workspace'
import './notes/notes.css'
import 'katex/dist/katex.min.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root를 찾을 수 없습니다')

createRoot(container).render(
  <StrictMode>
    <DesignProvider>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </DesignProvider>
  </StrictMode>
)
