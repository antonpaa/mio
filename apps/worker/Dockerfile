# Worker container (WP-09) - same base discipline as the API image.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY packages/authz/package.json packages/authz/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
COPY packages/schedule/package.json packages/schedule/
COPY packages/storage/package.json packages/storage/
COPY packages/survey-schema/package.json packages/survey-schema/
COPY packages/synthetic/package.json packages/synthetic/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --prod=false

FROM base
COPY --from=deps /app /app
COPY packages packages
COPY apps/worker apps/worker
WORKDIR /app/apps/worker
USER node
CMD ["npx", "tsx", "src/main.ts"]
