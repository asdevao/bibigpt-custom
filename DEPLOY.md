# BibiGPT 定制版部署说明

基于 [JimmyLv/BibiGPT-v1](https://github.com/JimmyLv/BibiGPT-v1) v2.38.0 源码的深度定制版。
相比原版新增：B站字幕五重防护（反 CDN 污染）、YouTube 字幕支持（含 ASR 自动字幕兜底）、任意 OpenAI 兼容厂商接入、限流自动降级、多厂商 BYOK、全链路中文报错。补丁清单见文末。

## 前置要求

- Docker + Docker Compose
- 一个 OpenAI 兼容的 LLM API Key（商汤/智谱/DeepSeek/Kimi 均可，**必须是非推理模型**——推理模型输出走 `reasoning_content`，本应用会拿到空总结）
- 一个 B站账号（AI 字幕必须登录态）
- 视频源需求：
  - 只用 B站 → 无需代理
  - 需要 YouTube → 必须有可用的 HTTP 代理（境外字幕源 savesubs.com 国内不可达，且对数据中心 IP 有反爬）

## 部署步骤

```bash
# 1. 配置环境变量
cp .env.example .env
vim .env   # 填入 API Key、B站 SESSDATA、站点地址；需要 YouTube 则填代理

# 2. 构建并启动（首次构建约 5-10 分钟，含 python3+yt-dlp 安装）
docker compose up -d --build

# 3. 验证
curl http://127.0.0.1:19368/          # 应返回 200
docker logs bibigpt --tail 20          # 无报错
```

浏览器打开 `http://你的IP:19368`，粘贴 B站或 YouTube 视频链接 → 一键总结。

## 网络架构说明（重要）

- **B站链路**：直连，无需代理。AI 字幕需要 `.env` 里的 B站 SESSDATA（有效期约 180 天，过期症状：所有带 AI 字幕的 B站视频报"字幕获取失败"；更换方法同获取方式）
- **YouTube 链路**：依赖 `HTTPS_PROXY`。默认 compose 使用 `network_mode: host`（为配合宿主机 `127.0.0.1:17890` 反向隧道方案）。**如果你有自己的代理**：
  - 代理在别的机器 → 把 `HTTPS_PROXY` 指向 `http://机器IP:端口`，并把 compose 改回 `ports: ["19368:3000"]` + 删掉 `PORT`/`HOSTNAME` 环境变量
  - 无代理 → YouTube 功能不可用（B站不受影响）
- **限流**：LLM 厂商账户级 RPM 限流时主模型自动降级到 `OPENAI_FALLBACK_MODEL`；注意同一账户的降级模型可能共享限流窗口，报"AI 模型繁忙"时等 1-2 分钟重试即可

## 日常维护

| 事项 | 症状 | 处理 |
|------|------|------|
| B站 SESSDATA 过期（约 180 天） | B站 AI 字幕视频全部报"字幕获取失败" | 浏览器 F12 → Network → api.bilibili.com 请求 → Cookie 里 SESSDATA → 更新 `.env` → `docker compose up -d --force-recreate` |
| savesubs token 失效 | 日志出现 `BLOCKED`（YouTube 受影响，B站不受影响） | 浏览器打开 savesubs.com 解析任意视频 → F12 抓 `/action/extract` 请求头 `x-auth-token` → 更新 `.env` |
| LLM 限流 | "AI 模型繁忙，请等 1-2 分钟后重试" | 等待即可，无需处理 |

## 补丁清单（升级原版会全部失效，勿直接覆盖）

1. `lib/upstash.ts` — Upstash 限流器降级 no-op
2. `lib/openai/fetchOpenAIResult.ts` — 端点/模型可配置；429 自动降级 `OPENAI_FALLBACK_MODEL`；错误中文化
3. `pages/api/sumup.ts` — max_tokens +1500 推理缓冲；字幕错误返回 JSON
4. Supabase 哑值（构建期 + 运行期）
5. `middleware.ts` — 空配置守护
6. `lib/bilibili/*` — player/v2 主路径 + 3 次重试 + 缓存绕行 + **身份锚点校验（防 CDN 污染总结成别的视频）** + 空字幕友好报错
7. `lib/youtube/proxyFetch.ts`(P1) — Node18 fetch 走 undici ProxyAgent（原生 fetch 不读 HTTPS_PROXY）
8. `pages/api/ytsub.ts` + `lib/fetchSubtitle.ts`(P2) — YouTube 字幕拆到 nodejs 运行时（Edge 禁 undici）
9. `lib/youtube/fetchYoutubeSubtitleUrls.ts`(P3) — savesubs 3 次重试 + HTML 捕获 + 隧道断/缺失 token 分类报错
10. `lib/youtube/ytDlpFallback.ts`(P4) — ASR 自动字幕 yt-dlp 兜底（savesubs 只支持人工字幕）
11. `lib/youtube/fetchYoutubeSubtitle.ts`(P5d) — 字幕内容 HTML 校验
12. 报错全链路中文化分类(P5) — 隧道断/限流/token 失效/视频不可访问 各有明确提示
13. `lib/bilibili/fetchBilibiliSubtitleUrls.ts`(P6b) — 身份锚点校验
14. `pages/api/sumup.ts` + `hooks/useSummarize.ts`(BYOK) — Key 框支持 `https://接口/v1|Key|模型名` 语法路由任意厂商
15. `Dockerfile` — 多阶段构建 + python3/yt-dlp；`.dockerignore` 确保 `.env` 不进镜像
