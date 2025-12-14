# Build stage
FROM golang:1.25-alpine AS builder

# Install sqlc
RUN go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest

WORKDIR /app

# Copy specs first (needed for go mod)
COPY specs/typespec /specs/typespec

# Copy go mod files first for caching
COPY api-server/go.mod api-server/go.sum ./
RUN go mod download

# Copy source code
COPY api-server/ .

# Generate sqlc code
RUN sqlc generate

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -o api-server ./cmd/api-server.go

# Runtime stage
FROM alpine:3.19

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /app/api-server .

EXPOSE 8080

CMD ["./api-server"]
