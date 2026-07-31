# syntax=docker/dockerfile:1

# nginx-unprivileged runs the master process as an unprivileged user and listens
# on 8080; the stock nginx image needs root to bind :80, which this static site
# has no reason to require. Pinned to a minor version so a rebuild is not an
# unreviewed nginx upgrade.
FROM nginxinc/nginx-unprivileged:1.29-alpine

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx index.html /usr/share/nginx/html/index.html

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --spider -q http://127.0.0.1:8080/healthz || exit 1
