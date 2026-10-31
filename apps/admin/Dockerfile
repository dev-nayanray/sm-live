FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --node-linker=hoisted --frozen-lockfile=false --filter @sm-live/admin --filter @sm-live/shared
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/admin apps/admin
ARG VITE_API_BASE=http://localhost:4000
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm --filter @sm-live/shared build && pnpm --filter @sm-live/admin build

FROM nginx:alpine
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
