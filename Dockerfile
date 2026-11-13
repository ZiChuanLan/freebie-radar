# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
RUN npm i -g pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY src ./src
RUN pnpm build

# ---- runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=192"
# curl + ca-certificates：部分源的 Cloudflare 对 Node undici TLS 指纹返回 403，
# RSS/直连采集通过 curl 拿 200，可显著减少对 FlareSolverr 的依赖。
RUN apk add --no-cache curl ca-certificates
COPY package.json pnpm-lock.yaml ./
RUN npm i -g pnpm@10 \
    && pnpm install --frozen-lockfile --prod \
    && npm uninstall -g pnpm \
    && rm -rf /root/.local/share/pnpm /root/.npm /tmp/*
COPY --from=build /app/dist ./dist
COPY src/server ./src/server
COPY tsconfig.json ./
RUN mkdir -p /data
EXPOSE 8788
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "src/server/index.ts"]
