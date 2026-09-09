import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite never runs standalone: server/index.ts loads this config and mounts the
// dev server as Fastify middleware, so `npm run dev` is a single process.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./client/src', import.meta.url)),
      '@': fileURLToPath(new URL('./client/src', import.meta.url))
    }
  }
})
