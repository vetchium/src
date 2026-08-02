# syntax=docker/dockerfile:1

FROM golang:1.25.7-alpine@sha256:f6751d823c26342f9506c03797d2527668d095b0a15f1862cddb4d927a7a4ced AS build

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
# image. Removing the committed output first prevents files for deleted queries
# from surviving into a production build.
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
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/workers ./cmd/workers

FROM gcr.io/distroless/static-debian12:nonroot@sha256:f5b485ea962d9bd1186b2f6b3a061191539b905b82ec395de78cbfae51f20e35 AS runtime

USER nonroot:nonroot
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
    CMD ["/service", "readycheck"]

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
