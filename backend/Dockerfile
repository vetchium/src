FROM golang:1.27.3-alpine@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS build

ARG VERSION=dev

# Downloaded modules stay in image layers, never in a /go/pkg/mod cache mount:
# BuildKit garbage-collects cache mounts while the layer that filled one stays
# cached, so a later step would find the modules gone and need the network.
COPY tools/sqlc/ /src/tools/sqlc/
WORKDIR /src/tools/sqlc
RUN --mount=type=cache,target=/root/.cache/go-build \
    GOBIN=/usr/local/bin go install tool

WORKDIR /src
COPY typespec/go.mod typespec/go.mod
COPY backend/go.mod backend/go.sum backend/
WORKDIR /src/backend
RUN go mod download

COPY typespec/ /src/typespec/
COPY backend/ .
COPY db/global-migrations /src/db/global-migrations
COPY db/migrations /src/db/migrations

# Generated database access is always rebuilt from the SQL sources in this
# image. A developer's local output is excluded by .dockerignore; removing the
# directory here as well keeps it out if the build context changes later.
RUN rm -rf internal/db/sqlc internal/globaldb/sqlc && \
    sqlc generate && \
    sqlc generate -f sqlc-global.yaml

RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/admin-api ./cmd/admin-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/hub-api ./cmd/hub-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/orgs-api ./cmd/orgs-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/mesh-api ./cmd/mesh-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/mcp-server ./cmd/mcp-server && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/workers ./cmd/workers && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/global-coordinator ./cmd/global-coordinator && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/dev-seed ./cmd/dev-seed && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/oidc-dev ./cmd/oidc-dev && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/ai-dev ./cmd/ai-dev && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X backend/internal/version.Value=${VERSION}" -o /out/doh-dev ./cmd/doh-dev

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

# Development fixtures only. This stage is absent from docker-bake.hcl, so it
# is never published and never deployed.
FROM runtime AS dev-seed
COPY --from=build /out/dev-seed /service
HEALTHCHECK NONE

# Development and CI identity provider only; never published or deployed.
FROM runtime AS oidc-dev
COPY --from=build /out/oidc-dev /service

# Development and CI model server stand-in only; never published or deployed.
FROM runtime AS ai-dev
COPY --from=build /out/ai-dev /service

# Development and CI DNS-over-HTTPS front for dns-dev only; never published or
# deployed.
FROM runtime AS doh-dev
COPY --from=build /out/doh-dev /service
