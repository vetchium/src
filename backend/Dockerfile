# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/admin-api ./cmd/admin-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/hub-api ./cmd/hub-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/orgs-api ./cmd/orgs-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mesh-api ./cmd/mesh-api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mcp-server ./cmd/mcp-server && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/workers ./cmd/workers

FROM gcr.io/distroless/static-debian12:nonroot AS runtime

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
