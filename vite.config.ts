import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 3000),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.CORE_PORT ?? Number(process.env.PORT ?? 3000) + 1}`,
        changeOrigin: false
      },
      '/_artifacts': {
        target: `http://127.0.0.1:${process.env.CORE_PORT ?? Number(process.env.PORT ?? 3000) + 1}`,
        changeOrigin: false
      },
      '/_web': {
        target: `http://127.0.0.1:${process.env.CORE_PORT ?? Number(process.env.PORT ?? 3000) + 1}`,
        changeOrigin: false
      }
    }
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./client/src', import.meta.url)),
      '@': fileURLToPath(new URL('./client/src', import.meta.url))
    }
  }
})
