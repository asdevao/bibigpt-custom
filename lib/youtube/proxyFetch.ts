// PATCH(P1): Node18 原生 fetch(undici) 不读 HTTPS_PROXY，YouTube 字幕链路需显式走代理
import { ProxyAgent, fetch as undiciFetch } from 'undici'

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

export async function proxyFetch(url: string, init: Record<string, unknown> = {}): Promise<Response> {
  if (!dispatcher) return fetch(url, init as RequestInit)
  return undiciFetch(url, { ...(init as object), dispatcher } as never) as unknown as Response
}
