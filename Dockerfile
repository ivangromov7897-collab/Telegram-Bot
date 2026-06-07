FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @workspace/api-server run build

FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/artifacts/api-server/dist ./dist

ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
