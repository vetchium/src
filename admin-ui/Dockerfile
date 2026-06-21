# Build stage
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy specs first (needed for vetchium-specs dependency)
COPY api-schema /api-schema

# Copy package files first for caching
COPY admin-ui/package.json admin-ui/bun.lock ./

RUN bun install --frozen-lockfile

# Copy source code
COPY admin-ui/ .

# Build the app
RUN bun run build

# Runtime stage - serve with bun (dev/default; fastest local flow, no nginx)
FROM oven/bun:1-alpine

WORKDIR /app

# Copy built assets and serve script
COPY --from=builder /app/dist ./dist
COPY admin-ui/serve.ts ./

EXPOSE 80

CMD ["bun", "serve.ts"]
