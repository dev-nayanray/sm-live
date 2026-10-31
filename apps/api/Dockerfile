# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --node-linker=hoisted --frozen-lockfile=false --filter @sm-live/api --filter @sm-live/shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @sm-live/shared build \
 && pnpm --filter @sm-live/api exec prisma generate \
 && pnpm --filter @sm-live/api build

# --- runtime stage ---
FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/src/index.js"]
