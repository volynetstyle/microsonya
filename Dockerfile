# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

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
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV="production"
RUN useradd --create-home --shell /usr/sbin/nologin microsonya
COPY --from=build --chown=microsonya:microsonya /app /app
USER microsonya
CMD ["node", "apps/telegram/bot/dist/main.js"]
