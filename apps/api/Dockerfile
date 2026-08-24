# API container (WP-09). The monorepo is source-first - no build step
# anywhere - so the runtime executes TypeScript directly with the same
# loader dev uses. One base for api and worker keeps drift impossible.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
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
# dev deps stay: the swc loader that runs the source is one of them
RUN pnpm install --frozen-lockfile --prod=false

# WP-30: the session cookie is same-origin by design, so the API serves
# the built SPA itself - the one true build step in the image.
FROM base AS webdist
COPY --from=deps /app /app
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @mio/web build

FROM base
COPY --from=deps /app /app
COPY packages packages
COPY apps/api apps/api
COPY docs/authz docs/authz
COPY --from=webdist /app/apps/web/dist /app/web-dist
ENV MIO_WEB_DIST=/app/web-dist
WORKDIR /app/apps/api
EXPOSE 3000
USER node
CMD ["node", "--import", "@swc-node/register/esm-register", "src/main.ts"]
