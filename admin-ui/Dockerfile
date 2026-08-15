# syntax=docker/dockerfile:1

FROM node:24.12.0-alpine@sha256:c921b97d4b74f51744057454b306b418cf693865e73b8100559189605f6955b8 AS build

WORKDIR /app

COPY admin-ui/package.json admin-ui/package-lock.json ./admin-ui/
WORKDIR /app/admin-ui
RUN --mount=type=cache,target=/root/.npm npm ci

COPY admin-ui/ ./
COPY typespec/ /app/typespec/
RUN npm run build

# nginx-unprivileged runs the master process as an unprivileged user and listens
# on 8080; the stock nginx image needs root to bind :80, which this static site
# has no reason to require. The readable version tag is locked to an immutable
# multi-platform digest so rebuilding a release uses the same base image.
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

COPY --chown=nginx:nginx admin-ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 admin-ui/runtime-config.sh /docker-entrypoint.d/40-vetchium-runtime-config.sh
COPY --from=build --chown=nginx:nginx /app/admin-ui/dist/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --spider -q http://127.0.0.1:8080/healthz || exit 1
