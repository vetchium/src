# The migration runner: the upstream goose CLI plus the versioned migrations.
#
# This is deliberately a *different image* from the API server so the runtime
# image does not carry migration tooling. Database privileges are separated by
# connection role: this runner uses the PostgreSQL administrator while API and
# worker processes connect as the DML-only `vetchium_app` role.
#
# The build context is ./db/migrations, so the API sources are not part of it.

FROM golang:1.27.3-alpine@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS build

# There is no official goose image published, so the CLI is built from source.
# Pinned to the same version the project develops against.
ARG GOOSE_VERSION=v3.27.3

# goose links a driver for every database it supports; the no_* tags strip the
# ones this project will never use, taking the binary from ~56MB to ~11MB.
# CGO_ENABLED=0 makes it static, which is what allows the distroless base
# below (and is also why sqlite3, which needs cgo, has to go).
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go install -trimpath -ldflags="-s -w" \
    -tags='no_clickhouse no_mssql no_mysql no_sqlite3 no_libsql no_vertica no_ydb' \
    github.com/pressly/goose/v3/cmd/goose@${GOOSE_VERSION}

FROM gcr.io/distroless/static-debian12:nonroot@sha256:f5b485ea962d9bd1186b2f6b3a061191539b905b82ec395de78cbfae51f20e35 AS runtime

USER nonroot:nonroot

COPY --from=build /go/bin/goose /goose
COPY *.sql /migrations/

# GOOSE_DRIVER and GOOSE_MIGRATION_DIR are fixed properties of this image;
# only GOOSE_DBSTRING varies per tenant and is supplied by the caller.
ENV GOOSE_DRIVER=postgres \
    GOOSE_MIGRATION_DIR=/migrations

ENTRYPOINT ["/goose"]
# Overridable, so the same image serves `status`, `version` and `down` without
# a separate build.
CMD ["up"]
