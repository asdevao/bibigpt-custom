import { fetchYoutubeSubtitleUrls, SUBTITLE_DOWNLOADER_URL } from '~/lib/youtube/fetchYoutubeSubtitleUrls'
import { proxyFetch } from '~/lib/youtube/proxyFetch'
import { find } from '~/utils/fp'
import { reduceYoutubeSubtitleTimestamp } from '~/utils/reduceSubtitleTimestamp'
import { fetchYoutubeSubtitleViaYtDlp } from '~/lib/youtube/ytDlpFallback'

// PATCH(P5d): savesubs 字幕下载接口也会偶发返回 HTML（限流/Cloudflare），校验+重试
async function downloadSubtitleContent(subtitleUrl: string, ext: 'json' | 'txt', attempts = 2): Promise<any | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await proxyFetch(`${SUBTITLE_DOWNLOADER_URL}${subtitleUrl}?ext=${ext}`)
    const text = await response.text()
    if (!/<!doctype html|<html[\s>]/i.test(text.slice(0, 500))) {
      return ext === 'json' ? JSON.parse(text) : text
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('YouTube 字幕源暂时限流（savesubs），请等 1-2 分钟后重试')
}

export async function fetchYoutubeSubtitle(videoId: string, shouldShowTimestamp: boolean | undefined) {
  const { title, subtitleList } = await fetchYoutubeSubtitleUrls(videoId)
  if (!subtitleList || subtitleList?.length <= 0) {
    // PATCH(P4): savesubs 无结果（ASR 自动字幕视频）→ yt-dlp 兜底
    const fallback = await fetchYoutubeSubtitleViaYtDlp(videoId, shouldShowTimestamp)
    if (fallback) return fallback
    return { title, subtitlesArray: null }
  }
  const betterSubtitle =
    find(subtitleList, { quality: 'zh-CN' }) ||
    find(subtitleList, { quality: 'English' }) ||
    find(subtitleList, { quality: 'English (auto' }) ||
    subtitleList[0]
  if (shouldShowTimestamp) {
    const subtitles = await downloadSubtitleContent(betterSubtitle.url, 'json')
    const transcripts = reduceYoutubeSubtitleTimestamp(subtitles)
    return { title, subtitlesArray: transcripts }
  }

  const subtitles = await downloadSubtitleContent(betterSubtitle.url, 'txt')
  const transcripts = subtitles.split('\r\n\r\n')?.map((text: string, index: number) => ({ text, index }))
  return { title, subtitlesArray: transcripts }
}
