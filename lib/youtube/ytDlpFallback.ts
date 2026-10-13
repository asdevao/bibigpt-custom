// PATCH(P4): savesubs 只支持人工字幕；ASR 自动字幕视频用容器内 yt-dlp 兜底
// PATCH(P5): 失败原因分类——429 限流 / 视频不可访问 抛可操作中文提示；其余静默回退到"无字幕"路径
import { execFile } from 'child_process'
import { mkdir, readdir, readFile, rm } from 'fs/promises'
import path from 'path'

const TMP_DIR = '/tmp/ytsubs'

export async function fetchYoutubeSubtitleViaYtDlp(
  videoId: string,
  shouldShowTimestamp?: boolean,
): Promise<{ title: string; subtitlesArray: any[] | null } | null> {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''
  await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {})
  await mkdir(TMP_DIR, { recursive: true }).catch(() => {})
  const outTemplate = path.join(TMP_DIR, `${videoId}_%(title)s`)
  const args = [
    '--proxy', proxy,
    '--skip-download',
    '--write-auto-subs', '--write-subs',
    '--sub-langs', 'zh.*,en.*',
    '--sub-format', 'json3/srv3/vtt',
    '--no-warnings', '--quiet',
    // YouTube 对 timedtext 偶发 429 限流，等待+重试可过
    '--retries', '5',
    '--sleep-subtitles', '3',
    '-o', outTemplate,
    `https://www.youtube.com/watch?v=${videoId}`,
  ]
  try {
    await new Promise<void>((resolve, reject) => {
      // PATCH(P5b): err.message 前 300 字符是命令行本身，错误详情在 stderr，用 err.stderr 做分类
      execFile('yt-dlp', args, { timeout: 150000, maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
        if (err) {
          const wrapped: any = new Error(`yt-dlp: ${String(stderr || err.message).slice(0, 500)}`)
          wrapped.stderr = String(stderr || '')
          reject(wrapped)
        } else resolve()
      })
    })
  } catch (e: any) {
    const msg = String(e?.stderr || e?.message || '')
    console.error('[yt-dlp fallback] failed:', msg.slice(0, 300))
    if (/429/.test(msg)) {
      throw new Error('YouTube 字幕接口暂时限流（HTTP 429），请等 1-2 分钟后重试')
    }
    if (/Private video|video is unavailable|Video unavailable|members-only|age.restricted|login required|Join this channel/i.test(msg)) {
      throw new Error('该视频不可访问（私有、会员专享或已删除），无法获取字幕')
    }
    // 其余失败（偶发网络抖动等）→ 按"无字幕"处理，走上层统一提示
    await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {})
    return null
  }
  const files = await readdir(TMP_DIR)
  const candidates = files.filter((f) => f.startsWith(`${videoId}_`) && f.endsWith('.json3'))
  if (!candidates.length) {
    console.error('[yt-dlp fallback] no .json3 files produced (video may have no captions), dir:', files.join(', '))
    await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {})
    return null
  }
  const subFile =
    candidates.find((f) => /_zh|\.zh-/.test(f)) || candidates.find((f) => /\.en/.test(f)) || candidates[0]
  let events: any[] = []
  try {
    const raw = JSON.parse(await readFile(path.join(TMP_DIR, subFile), 'utf-8'))
    events = raw?.events ?? []
  } catch {
    await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {})
    return null
  }
  const transcripts = events
    .map((e: any, i: number) => {
      const text = (e.segs ?? [])
        .map((s: any) => s.utf8 ?? '')
        .join('')
        .replace(/\n/g, ' ')
        .trim()
      const item: any = { text, index: i }
      if (shouldShowTimestamp && e.tStartMs != null) {
        item.start = e.tStartMs / 1000
        item.duration = (e.dDurationMs ?? 0) / 1000
      }
      return item
    })
    .filter((t: any) => t.text)
  // PATCH(P5c): 限流期间 YouTube 会返回 HTML 错误页伪装成字幕文件——校验内容
  if (transcripts.length && /<!doctype html|<html/i.test(transcripts[0].text)) {
    console.error('[yt-dlp fallback] caption file is an HTML error page (rate-limited?)')
    await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {})
    throw new Error('YouTube 字幕接口暂时限流，请等 1-2 分钟后重试')
  }
  const title = subFile.slice(videoId.length + 1, -'.json3'.length) || videoId
  await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {})
  return transcripts.length ? { title, subtitlesArray: transcripts } : null
}
