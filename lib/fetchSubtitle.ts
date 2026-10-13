import { fetchBilibiliSubtitle } from './bilibili/fetchBilibiliSubtitle'
import { CommonSubtitleItem, VideoConfig, VideoService } from './types'

export async function fetchSubtitle(
  videoConfig: VideoConfig,
  shouldShowTimestamp?: boolean,
): Promise<{
  title: string
  subtitlesArray?: null | Array<CommonSubtitleItem>
  descriptionText?: string
}> {
  const { service, videoId, pageNumber } = videoConfig
  console.log('video: ', videoConfig)
  if (service === VideoService.Youtube) {
    // PATCH(P2): edge runtime 禁 undici，YouTube 字幕改走本机 nodejs 路由（内部回环，不需代理）
    const port = process.env.PORT || '3000'
    const internalUrl = `http://127.0.0.1:${port}/api/ytsub?videoId=${encodeURIComponent(videoId)}${shouldShowTimestamp ? '&ts=1' : ''}`
    const response = await fetch(internalUrl)
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data?.errorMessage || 'YouTube subtitle fetch failed')
    }
    return data
  }
  return await fetchBilibiliSubtitle(videoId, pageNumber, shouldShowTimestamp)
}
