import { Redis } from '@upstash/redis'
import { createParser, ParsedEvent, ReconnectInterval } from 'eventsource-parser'
import { trimOpenAiResult } from '~/lib/openai/trimOpenAiResult'
import { VideoConfig } from '~/lib/types'
import { isDev } from '~/utils/env'
import { getCacheId } from '~/utils/getCacheId'

export enum ChatGPTAgent {
  user = 'user',
  system = 'system',
  assistant = 'assistant',
}

export interface ChatGPTMessage {
  role: ChatGPTAgent
  content: string
}
export interface OpenAIStreamPayload {
  api_key?: string
  model: string
  messages: ChatGPTMessage[]
  temperature?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  max_tokens: number
  stream: boolean
  n?: number
}

export async function fetchOpenAIResult(payload: OpenAIStreamPayload, apiKey: string, videoConfig: VideoConfig) {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  isDev && console.log({ apiKey })
  // PATCH(K): 支持 baseUrl|apiKey|model 扩展语法（多厂商 BYOK），默认走环境变量的商汤端点
  let effectiveBaseUrl = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1'
  let effectiveApiKey = apiKey ?? ''
  let effectivePayload = payload
  if (apiKey && apiKey.includes('|')) {
    const parts = apiKey.split('|')
    if (parts.length >= 2 && parts[0].startsWith('http')) {
      effectiveBaseUrl = parts[0].replace(/\/+$/, '')
      effectiveApiKey = parts[1]
      if (parts[2]) {
        effectivePayload = { ...payload, model: parts[2] }
      }
    }
  }
  // PATCH(限流降级): 主模型 429 时自动换备用模型重试一次
  const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'glm-5.2'
  async function callChatCompletions(pl: any) {
    return fetch(effectiveBaseUrl + '/chat/completions', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + effectiveApiKey,
      },
      method: 'POST',
      body: JSON.stringify(pl),
    })
  }
  let res = await callChatCompletions(effectivePayload)
  if (res.status === 429) {
    console.warn('[fallback] primary model rate-limited, retrying with ' + FALLBACK_MODEL)
    const retryPayload = JSON.parse(JSON.stringify(effectivePayload))
    retryPayload.model = FALLBACK_MODEL
    res = await callChatCompletions(retryPayload)
  }

  if (res.status !== 200) {
    // PATCH(P5): 用户可见报错中文化；429 = 主模型与备用模型均限流
    let msg = ''
    try {
      const errorJson = await res.json()
      msg = errorJson?.error?.message || ''
    } catch {
      msg = res.statusText
    }
    if (res.status === 429) {
      throw new Error('AI 模型繁忙（主模型与备用模型均限流），请等 1-2 分钟后重试')
    }
    throw new Error(`AI 模型请求失败 [${res.status}]: ${msg || res.statusText}`)
  }

  const redis = process.env.UPSTASH_REDIS_REST_URL ? Redis.fromEnv() : null
  const cacheId = getCacheId(videoConfig)

  if (!payload.stream) {
    const result = await res.json()
    const betterResult = trimOpenAiResult(result)

    const data = redis ? await redis.set(cacheId, betterResult) : null
    console.info(`video ${cacheId} cached:`, data)
    isDev && console.log('========betterResult========', betterResult)

    return betterResult
  }

  let counter = 0
  let tempData = ''
  const stream = new ReadableStream({
    async start(controller) {
      // callback
      async function onParse(event: ParsedEvent | ReconnectInterval) {
        if (event.type === 'event') {
          const data = event.data
          // https://beta.openai.com/docs/api-reference/completions/create#completions/create-stream
          if (data === '[DONE]') {
            // active
            controller.close()
            const data = redis ? await redis.set(cacheId, tempData) : null
            console.info(`video ${cacheId} cached:`, data)
            isDev && console.log('========betterResult after streamed========', tempData)
            return
          }
          try {
            const json = JSON.parse(data)
            const text = json.choices[0].delta?.content || ''
            // todo: add redis cache
            tempData += text
            if (counter < 2 && (text.match(/\n/) || []).length) {
              // this is a prefix character (i.e., "\n\n"), do nothing
              return
            }
            const queue = encoder.encode(text)
            controller.enqueue(queue)
            counter++
          } catch (e) {
            // maybe parse error
            controller.error(e)
          }
        }
      }

      // stream response (SSE) from OpenAI may be fragmented into multiple chunks
      // this ensures we properly read chunks and invoke an event for each SSE event stream
      const parser = createParser(onParse)
      // https://web.dev/streams/#asynchronous-iteration
      for await (const chunk of res.body as any) {
        parser.feed(decoder.decode(chunk))
      }
    },
  })

  return stream
}
