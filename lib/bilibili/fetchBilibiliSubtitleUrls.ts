import { find, sample } from '~/utils/fp'

type BilibiliSubtitles = {
  lan: string
  subtitle_url: string
}

interface BilibiliVideoInfo {
  title: string
  desc?: string
  dynamic?: string
  subtitle?: {
    list: BilibiliSubtitles[]
  }
}
export const fetchBilibiliSubtitleUrls = async (
  videoId: string,
  pageNumber?: null | string,
): Promise<BilibiliVideoInfo> => {
  const sessdata = sample(process.env.BILIBILI_SESSION_TOKEN?.split(','))
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    Host: 'api.bilibili.com',
    Cookie: `SESSDATA=${sessdata}`,
  }
  const commonConfig: RequestInit = {
    method: 'GET',
    cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
    headers,
    referrerPolicy: 'no-referrer', // no-referrer, *no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url
  }

  const params = videoId.startsWith('av') ? `?aid=${videoId.slice(2)}` : `?bvid=${videoId}`
  const requestUrl = `https://api.bilibili.com/x/web-interface/view${params}`
  console.log(`fetch`, requestUrl)
  const response = await fetch(requestUrl, commonConfig)
  const json = await response.json()

  // support multiple parts of video
  if (pageNumber) {
    const { aid, pages } = json?.data || {}
    const { cid } = find(pages, { page: Number(pageNumber) }) || {}

    // https://api.bilibili.com/x/player/v2?aid=865462240&cid=1035524244
    const pageUrl = `https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`
    const res = await fetch(pageUrl, commonConfig)
    const j = await res.json()

    // r.data.subtitle.subtitles
    return { ...json.data, subtitle: { list: j.data.subtitle.subtitles } }
  }

  // return json.data.View;
  // { code: -404, message: '啥都木有', ttl: 1 }

  // PATCH(self-host): B站 view API 的 subtitle.list 里 subtitle_url 已全部为空字符串，
  // 主路径统一改走 player/v2 获取真实字幕地址
  const { aid, cid } = json?.data || {}
  if (aid && cid) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const pageUrl = 'https://api.bilibili.com/x/player/v2?aid=' + aid + '&cid=' + cid + '&_cb=' + Date.now()
        const res = await fetch(pageUrl, commonConfig)
        const j = await res.json()
        const subtitles = (j && j.data && j.data.subtitle && j.data.subtitle.subtitles) || []
        console.log('player/v2 attempt ' + attempt + ' subtitles: ' + subtitles.length)
        // PATCH(P6b): 身份锚点校验——只保留内嵌 <aid><cid> 且匹配的 ai_subtitle 条目（主字幕必然内嵌）。
        // 纯 hash 的 AI 翻译字幕条目无法验身份：跟随主字幕生成，主字幕匹配时跟随采用（下游取 lan/首条）；
        // 主字幕都不匹配 = CDN 污染（整列表被换成别的视频，2026-09-24 实测总结成小米SU7），触发重试。
        const usable = subtitles.filter((s: { subtitle_url?: string; lan?: string }) => {
          const u = s.subtitle_url || ''
          const pass = u.includes('ai_subtitle') && u.includes(String(aid)) && u.includes(String(cid))
          // PATCH(P6-log): 打印每条判定过程，失败时可取证（URL/lan/aid/cid/判定）
          console.log('P6b [' + attempt + '] lan=' + (s.lan || '?') + ' pass=' + pass + ' aid=' + aid + ' cid=' + cid + ' url=' + u.slice(0, 120))
          return pass
        })
        if (usable.length > 0) {
          return { ...json.data, subtitle: { list: usable } }
        }
      } catch (e) {
        console.error('player/v2 attempt ' + attempt + ' failed', e)
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  // PATCH(加固): 永不信任 view 接口的 subtitle 数据（2026-06 社区观察: CDN 可能返回
  // 缓存的错误视频字幕URL; 2026-09 实测: URL 全为空串）。player/v2 重试全失败时直接抛错。
  throw new Error('B站字幕获取失败：多次尝试均未拿到有效字幕地址，请稍后重试或换一个有字幕的视频')
}
