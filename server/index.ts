import { fileURLToPath } from 'node:url'
import path from 'node:path'
import middie from '@fastify/middie'
import { createServer as createViteServer } from 'vite'
import { createApp } from './app'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const port = Number(process.env.PORT ?? 3000)
const app = createApp()
const vite = await createViteServer({
  configFile: path.join(root, 'vite.config.ts'),
  root: path.join(root, 'client'),
  server: { middlewareMode: true, hmr: { server: app.server } },
  appType: 'spa'
})
await app.register(middie)
app.use((req, res, next) =>
  req.url?.startsWith('/api/') ? next() : vite.middlewares(req, res, next)
)
await app.listen({ port, host: '127.0.0.1' })
console.log(`oh-my-maek v1 → http://127.0.0.1:${port}`)
const shutdown = async () => {
  await app.close()
  await vite.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
