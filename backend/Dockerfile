# syntax=docker/dockerfile:1

FROM golang:1.27.0-alpine@sha256:4c9fe60190a2a3350ddc51de80d0224b8a6698d12bdfc999fee45ea9d6c46dbc AS build

ARG VERSION=dev

WORKDIR /src

COPY typespec/go.mod typespec/go.mod
COPY backend/go.mod backend/go.sum backend/
WORKDIR /src/backend
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY typespec/ /src/typespec/
COPY backend/ .
COPY db/migrations /src/db/migrations

# Generated database access is always rebuilt from the SQL sources in this
# image. The committed output is excluded by .dockerignore; removing the
# directory here as well prevents stale files from surviving if the build
# context changes later.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    rm -rf internal/db/sqlc && \
    go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.29.0 generate

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/admin-api ./cmd/admin-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/hub-api ./cmd/hub-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/orgs-api ./cmd/orgs-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/mesh-api ./cmd/mesh-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/mcp-server ./cmd/mcp-server && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/workers ./cmd/workers && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/global-coordinator ./cmd/global-coordinator && \
    mkdir /out/global-coordinator-state

FROM gcr.io/distroless/static-debian12:nonroot@sha256:f5b485ea962d9bd1186b2f6b3a061191539b905b82ec395de78cbfae51f20e35 AS runtime

USER nonroot:nonroot
EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=2s --start-period=5s --retries=5 \
    CMD ["/service", "healthcheck"]

ENTRYPOINT ["/service"]

FROM runtime AS admin-api
COPY --from=build /out/admin-api /service

FROM runtime AS hub-api
COPY --from=build /out/hub-api /service

FROM runtime AS orgs-api
COPY --from=build /out/orgs-api /service

FROM runtime AS mesh-api
COPY --from=build /out/mesh-api /service

FROM runtime AS mcp-server
COPY --from=build /out/mcp-server /service

FROM runtime AS workers
COPY --from=build /out/workers /service
HEALTHCHECK NONE

FROM runtime AS global-coordinator
COPY --from=build /out/global-coordinator /service
COPY --from=build --chown=nonroot:nonroot /out/global-coordinator-state /var/lib/vetchium-global-coordinator
