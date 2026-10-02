# syntax=docker/dockerfile:1

FROM node:24.12.0-alpine@sha256:c921b97d4b74f51744057454b306b418cf693865e73b8100559189605f6955b8 AS build

WORKDIR /app

COPY orgs-ui/package.json orgs-ui/package-lock.json ./orgs-ui/
COPY portal-ui/ /app/portal-ui/
COPY typespec/ /app/typespec/
WORKDIR /app/orgs-ui
RUN --mount=type=cache,target=/root/.npm npm ci

COPY orgs-ui/ ./
# dev, ci, or production: selects the compiled-in region table. The build
# fails when it is unset or unknown.
ARG VITE_VETCHIUM_ENVIRONMENT
# nginx serves the generated include instead of the static host's files.
RUN npm run build && rm dist/_headers dist/_redirects

# nginx-unprivileged runs the master process as an unprivileged user and listens
# on 8080; the stock nginx image needs root to bind :80, which this static site
# has no reason to require. The readable version tag is locked to an immutable
# multi-platform digest so rebuilding a release uses the same base image.
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

COPY --chown=nginx:nginx orgs-ui/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/orgs-ui/dist-nginx/portal.conf /etc/nginx/vetchium/portal.conf
COPY --from=build --chown=nginx:nginx /app/orgs-ui/dist/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --spider -q http://127.0.0.1:8080/healthz || exit 1
