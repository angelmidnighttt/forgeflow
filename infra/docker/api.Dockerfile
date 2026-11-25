# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f infra/docker/api.Dockerfile -t forgeflow-api .
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /app

# Workspace manifests only, so dependency layers stay cached until a package.json changes.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM manifests AS build
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN npx tsc -b apps/api

FROM manifests AS prod-deps
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspace @forgeflow/api

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/config/package.json ./packages/config/package.json
COPY --from=build /app/packages/config/dist ./packages/config/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/database/package.json ./packages/database/package.json
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/database/migrations ./packages/database/migrations
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
USER node
EXPOSE 4000
# Migrations run as a separate step before a new version takes traffic:
#   docker run --rm -e DATABASE_URL=... forgeflow-api node packages/database/dist/scripts/migrate.js
CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]
