import Fastify from 'fastify'
import { z } from 'zod'
import { LibraryStore, LibraryError } from './library'
import { idSchema, noteInputSchema } from '../shared/notes'

export function createApp(root: string) {
  const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 })
  const library = new LibraryStore(root)
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
    if (err instanceof z.ZodError)
      return reply
        .code(400)
        .send({ message: '입력 형식을 확인하세요.', details: err.issues })
    if (err instanceof LibraryError)
      return reply.code(err.statusCode).send({ message: err.message })
    console.error(err)
    return reply
      .code(500)
      .send({
        message:
          '저장소를 읽거나 저장하지 못했습니다. 서버 로그와 파일을 확인하세요.'
      })
  })
  app.get('/api/library', async () => ({
    notes: library.list(),
    databases: library.databases()
  }))
  app.post('/api/notes', async (req) => library.create(req.body))
  app.put<{ Params: { id: string } }>('/api/notes/:id', async (req) => {
    const data = noteInputSchema
      .extend({ revision: z.string().min(1) })
      .parse(req.body)
    return library.update(idSchema.parse(req.params.id), data.revision, data)
  })
  app.get<{ Params: { id: string } }>('/api/notes/:id/history', async (req) =>
    library.history(idSchema.parse(req.params.id))
  )
  app.post('/api/databases', async (req) => library.createDatabase(req.body))
  app.post<{ Params: { id: string } }>(
    '/api/databases/:id/fields',
    async (req) => library.addField(req.params.id, req.body)
  )
  return app
}
