# syntax=docker/dockerfile:1

# The migration runner: the upstream goose CLI plus the common migrations.
#
# This is deliberately a *different image* from the API server. The two need
# different database privileges — this one needs DDL (CREATE/ALTER/DROP), the
# API needs only DML — and separate images are what let them be granted
# separately. Nothing that serves traffic ever carries DDL rights.
#
# The build context is ./migrations, so the API sources are not part of it.

FROM golang:1.25-alpine AS build

# There is no official goose image published, so the CLI is built from source.
# Pinned to the same version the project develops against.
ARG GOOSE_VERSION=v3.27.3

# goose links a driver for every database it supports; the no_* tags strip the
# ones this project will never use, taking the binary from ~56MB to ~11MB.
# CGO_ENABLED=0 makes it static, which is what allows the distroless base
# below (and is also why sqlite3, which needs cgo, has to go).
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go install -trimpath -ldflags="-s -w" \
    -tags='no_clickhouse no_mssql no_mysql no_sqlite3 no_libsql no_vertica no_ydb' \
    github.com/pressly/goose/v3/cmd/goose@${GOOSE_VERSION}

FROM gcr.io/distroless/static-debian12:nonroot AS runtime

USER nonroot:nonroot

COPY --from=build /go/bin/goose /goose
COPY common /migrations/common

# GOOSE_DRIVER and GOOSE_MIGRATION_DIR are fixed properties of this image;
# only GOOSE_DBSTRING varies per tenant and is supplied by the caller.
ENV GOOSE_DRIVER=postgres \
    GOOSE_MIGRATION_DIR=/migrations/common

ENTRYPOINT ["/goose"]
# Overridable, so the same image serves `status`, `version` and `down` without
# a separate build.
CMD ["up"]
