FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/provider-mock/package.json apps/provider-mock/
RUN pnpm install --frozen-lockfile=false --filter @sm-live/provider-mock --filter @sm-live/shared
COPY packages/shared packages/shared
COPY apps/provider-mock apps/provider-mock
RUN pnpm --filter @sm-live/shared build && pnpm --filter @sm-live/provider-mock build

FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo ./
WORKDIR /repo/apps/provider-mock
EXPOSE 4100
CMD ["node", "dist/src/index.js"]
