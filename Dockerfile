# ---- build ----
FROM node:24-slim AS build
WORKDIR /app
RUN npm i -g pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY tests ./tests
RUN pnpm build

# ---- runtime ----
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN npm i -g pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY src ./src
COPY tsconfig.json ./
EXPOSE 8788
VOLUME ["/data"]
CMD ["node", "--no-warnings", "node_modules/tsx/dist/cli.mjs", "src/server/index.ts"]
