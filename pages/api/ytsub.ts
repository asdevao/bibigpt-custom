// PATCH(P2): YouTube 字幕抓取走 nodejs 运行时（undici 代理），供 edge 路由 /api/sumup 内部调用
import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchYoutubeSubtitle } from '~/lib/youtube/fetchYoutubeSubtitle'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const videoId = String(req.query.videoId || '')
  const shouldShowTimestamp = req.query.ts === '1'
  if (!videoId) {
    return res.status(400).json({ errorMessage: 'No videoId' })
  }
  try {
    const result = await fetchYoutubeSubtitle(videoId, shouldShowTimestamp)
    res.status(200).json(result)
  } catch (error: any) {
    res.status(500).json({ errorMessage: error?.message || 'ytsub failed' })
  }
}
