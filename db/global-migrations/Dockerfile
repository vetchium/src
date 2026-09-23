# syntax=docker/dockerfile:1

FROM golang:1.27.0-alpine@sha256:4c9fe60190a2a3350ddc51de80d0224b8a6698d12bdfc999fee45ea9d6c46dbc AS build

ARG GOOSE_VERSION=v3.27.3

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go install -trimpath -ldflags="-s -w" \
    -tags='no_clickhouse no_mssql no_mysql no_sqlite3 no_libsql no_vertica no_ydb' \
    github.com/pressly/goose/v3/cmd/goose@${GOOSE_VERSION}

FROM gcr.io/distroless/static-debian12:nonroot@sha256:f5b485ea962d9bd1186b2f6b3a061191539b905b82ec395de78cbfae51f20e35 AS runtime

USER nonroot:nonroot

COPY --from=build /go/bin/goose /goose
COPY *.sql /migrations/

ENV GOOSE_DRIVER=postgres \
    GOOSE_MIGRATION_DIR=/migrations

ENTRYPOINT ["/goose"]
CMD ["up"]
