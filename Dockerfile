# syntax=docker/dockerfile:1.7
# 基础镜像用 alpine：better-sqlite3 自带 linuxmusl 预编译包，体积比 debian-slim 小约 90MB
# 友邻 Youlin · Node 运行时镜像（与 Cloudflare Workers 同一份代码）

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# 依赖（含 dev，用于构建前端与服务端）
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# 构建：web/dist（Vite）+ server/dist（esbuild 单文件，better-sqlite3 外置）
FROM deps AS build
WORKDIR /app
COPY . .
RUN pnpm build && pnpm build:server

# 运行时依赖：只装根包的生产依赖（不含 web 的 React 等）
FROM base AS prod-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter youlin

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/data/youlin.db \
    WEB_ROOT=/app/web/dist \
    MIGRATIONS_DIR=/app/migrations

WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/migrations ./migrations

# 数据目录归 node 所有；用命名卷时卷会继承这里的属主
RUN mkdir -p /data && chown node:node /data
USER node

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/main.mjs"]
