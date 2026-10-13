export const SUBTITLE_DOWNLOADER_URL = 'https://savesubs.com'
import { proxyFetch } from '~/lib/youtube/proxyFetch'
export async function fetchYoutubeSubtitleUrls(videoId: string) {
  // PATCH(P3): savesubs 偶发 NO_LINKS/BLOCKED，实测重试可成功，最多 3 次
  let json: any = {}
  let lastRawMessage = ''
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await proxyFetch(SUBTITLE_DOWNLOADER_URL + '/action/extract', {
        method: 'POST',
        body: JSON.stringify({
          data: { url: `https://www.youtube.com/watch?v=${videoId}` },
        }),
        headers: {
          'Content-Type': 'text/plain',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
          'X-Auth-Token': `${process.env.SAVESUBS_X_AUTH_TOKEN}` || '',
          'X-Requested-Domain': 'savesubs.com',
          'X-Requested-With': 'xmlhttprequest',
        },
      })
      let parsed: any = null
      try {
        parsed = await response.json()
      } catch {
        // PATCH(P3b): 偶发返回 HTML（Cloudflare 等），按无结果处理继续重试
        parsed = null
      }
      lastRawMessage = parsed?.message || ''
      json = parsed?.response ?? {}
      if (json?.formats?.length > 0) break
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000))
    }
  } catch (e: any) {
    // PATCH(P5): 代理通道故障（主电脑离线/隧道断开）——快速失败并给出可操作提示
    console.error('[savesubs] proxy/network failure:', e?.message)
    throw new Error('网络代理通道中断（服务器无法连接字幕源，可能主电脑离线），请联系管理员重连 SSH 隧道')
  }
  // PATCH(P5): token 被拒（BLOCKED）时不直接失败——继续走 yt-dlp 兜底（不依赖 savesubs）
  if (lastRawMessage === 'BLOCKED' && !(json?.formats?.length > 0)) {
    console.error('[savesubs] BLOCKED：SAVESUBS_X_AUTH_TOKEN 可能已失效，请联系管理员更新 .env 配置（yt-dlp 兜底继续）')
  }
  // console.log("========json========", json);
  /*
  * "title": "Microsoft vs Google: AI War Explained | tech",
    "duration": "13 minutes and 15 seconds",
    "duration_raw": "795",
    "uploader": "Joma Tech / 2023-02-20",
    "thumbnail": "//i.ytimg.com/vi/BdHaeczStRA/mqdefault.jpg",
  * */
  return { title: json.title, subtitleList: json.formats }
}
