export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}
export async function request<T>(
  url: string,
  method = 'GET',
  body?: unknown
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = await response.json()
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.message ?? '요청을 처리하지 못했습니다.'
    )
  return data as T
}
export function download(name: string, text: string, type = 'text/markdown') {
  const url = URL.createObjectURL(
    new Blob([text], { type: `${type};charset=utf-8` })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = name.replace(/[\\/:*?"<>|]/g, '_')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
