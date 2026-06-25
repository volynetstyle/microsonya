# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
RUN corepack enable

FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/telegram/bot/package.json apps/telegram/bot/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/model-gateway/package.json packages/model-gateway/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/summarize/package.json packages/summarize/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM build AS deploy
RUN pnpm deploy --filter ./apps/telegram/bot --prod /prod

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV="production"
WORKDIR /app

RUN useradd --create-home --shell /usr/sbin/nologin microsonya

COPY --from=deploy --chown=microsonya:microsonya /prod ./

USER microsonya

CMD ["node", "dist/main.js"]