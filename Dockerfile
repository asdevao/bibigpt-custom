FROM node:18-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && (npm ci --ignore-scripts || npm install --ignore-scripts)

FROM node:18-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_SITE_URL=http://localhost:19368
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
# 哑值绕过 Supabase 客户端构建期校验（自部署不用官方登录）
ENV NEXT_PUBLIC_SUPABASE_URL=https://dummy.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.anon-key
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
# PATCH(P4): yt-dlp 兜底 savesubs 不支持的 ASR 自动字幕
RUN apk add --no-cache python3 py3-pip     && pip3 install --no-cache-dir --break-system-packages -i https://mirrors.aliyun.com/pypi/simple/ yt-dlp
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 3000
CMD ["npm", "start"]
