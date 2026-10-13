import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { FREE_LIMIT_COUNT, LOGIN_LIMIT_COUNT } from '~/utils/constants'

// PATCH(self-host): no-op rate limiters when Upstash is not configured
const rateRedisUrl = process.env.UPSTASH_RATE_REDIS_REST_URL
const rateRedisToken = process.env.UPSTASH_RATE_REDIS_REST_TOKEN

const noopRatelimit = {
  limit: async (..._args: unknown[]) => ({ success: true, remaining: 9999 }),
} as unknown as Ratelimit

let ratelimitForIps: Ratelimit = noopRatelimit
let ratelimitForApiKeyIps: Ratelimit = noopRatelimit
let ratelimitForFreeAccounts: Ratelimit = noopRatelimit

if (rateRedisUrl && rateRedisToken) {
  const redis = new Redis({ url: rateRedisUrl, token: rateRedisToken })
  ratelimitForIps = new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(FREE_LIMIT_COUNT, '1 d'), analytics: true })
  ratelimitForApiKeyIps = new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(FREE_LIMIT_COUNT * 2, '1 d'), analytics: true })
  ratelimitForFreeAccounts = new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(LOGIN_LIMIT_COUNT, '1 d'), analytics: true })
}

export { ratelimitForIps, ratelimitForApiKeyIps, ratelimitForFreeAccounts }
