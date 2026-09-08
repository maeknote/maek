import Fastify from 'fastify'
import { z } from 'zod'
import { LibraryStore, LibraryError } from './library'
import { idSchema, noteInputSchema } from '../shared/notes'
import { getWorkspace, registerWorkspace, toRef } from './workspaces'
import { pickDirectory } from './fs/pickDirectory'
import { RpcHttpError } from './errors'
import { watch } from 'node:fs'

export function createApp(root: string) {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 })
  const library = new LibraryStore(root)
  const stores = new Map<string, LibraryStore>()
  const store = (headers: Record<string, unknown>) => {
    const id = headers['x-workspace-id']
    if (!id) return library
    const ws = getWorkspace(z.string().parse(id))
    let selected = stores.get(ws.wsId)
    if (!selected) {
      selected = new LibraryStore(ws.root)
      stores.set(ws.wsId, selected)
    }
    return selected
  }
  const streams = new Set<() => void>()
  app.addHook('preClose', async () => {
    for (const close of streams) close()
  })
  app.addHook('onRequest', async (req, reply) => {
    const host = req.headers.host ?? ''
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))
      return reply.code(403).send({ message: '로컬 주소로 접속하세요.' })
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      return reply
        .code(403)
        .send({ message: '다른 사이트의 요청은 허용되지 않습니다.' })
  })
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof RpcHttpError)
      return reply.code(err.status).send({ message: err.message })
    if (err instanceof z.ZodError)
      return reply
        .code(400)
        .send({ message: '입력 형식을 확인하세요.', details: err.issues })
    if (err instanceof LibraryError)
      return reply.code(err.statusCode).send({ message: err.message })
    console.error(err)
    return reply.code(500).send({
      message:
        '저장소를 읽거나 저장하지 못했습니다. 서버 로그와 파일을 확인하세요.'
    })
  })
  app.post('/api/workspaces/open', async (req) => {
    const { path } = z.object({ path: z.string().min(1) }).parse(req.body)
    return toRef(await registerWorkspace(path))
  })
  app.post('/api/workspaces/pick', async () => pickDirectory())
  app.get<{ Querystring: { workspace: string } }>(
    '/api/workspaces/events',
    async (req, reply) => {
      const ws = getWorkspace(z.string().parse(req.query.workspace))
      const watcher = watch(ws.root, { recursive: true })
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })
      reply.raw.write('event: ready\ndata: {}\n\n')
      let timer: ReturnType<typeof setTimeout> | undefined
      const heartbeat = setInterval(
        () => reply.raw.write(': heartbeat\n\n'),
        20000
      )
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        watcher.close()
        clearTimeout(timer)
        clearInterval(heartbeat)
        streams.delete(close)
        reply.raw.end()
      }
      streams.add(close)
      req.raw.on('close', close)
      watcher.on('error', () => {
        reply.raw.write('event: watch-error\ndata: {}\n\n')
        close()
      })
      watcher.on('change', (_event, filename) => {
        if (filename?.toString().endsWith('.tmp')) return
        clearTimeout(timer)
        timer = setTimeout(
          () => reply.raw.write('event: change\ndata: {}\n\n'),
          150
        )
      })
    }
  )
  app.get('/api/library', async (req) => ({
    notes: store(req.headers).list(),
    databases: store(req.headers).databases()
  }))
  app.post('/api/notes', async (req) => store(req.headers).create(req.body))
  app.put<{ Params: { id: string } }>('/api/notes/:id', async (req) => {
    const data = noteInputSchema
      .extend({ revision: z.string().min(1) })
      .parse(req.body)
    return store(req.headers).update(
      idSchema.parse(req.params.id),
      data.revision,
      data
    )
  })
  app.get<{ Params: { id: string } }>('/api/notes/:id/history', async (req) =>
    store(req.headers).history(idSchema.parse(req.params.id))
  )
  app.post('/api/databases', async (req) =>
    store(req.headers).createDatabase(req.body)
  )
  app.post<{ Params: { id: string } }>(
    '/api/databases/:id/fields',
    async (req) => store(req.headers).addField(req.params.id, req.body)
  )
  return app
}
