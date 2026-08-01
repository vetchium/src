# syntax=docker/dockerfile:1

# nginx-unprivileged runs the master process as an unprivileged user and listens
# on 8080; the stock nginx image needs root to bind :80, which this static site
# has no reason to require. The readable version tag is locked to an immutable
# multi-platform digest so rebuilding a release uses the same base image.
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx index.html /usr/share/nginx/html/index.html

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --spider -q http://127.0.0.1:8080/healthz || exit 1
