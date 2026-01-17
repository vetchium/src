# Build stage
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy specs first (needed for vetchium-specs dependency)
COPY specs/typespec /specs/typespec

# Copy package files first for caching
COPY employer-ui/package.json employer-ui/bun.lock ./

RUN bun install --frozen-lockfile

# Copy source code
COPY employer-ui/ .

# Build the app
RUN bun run build

# Runtime stage - serve with bun
FROM oven/bun:1-alpine

WORKDIR /app

# Copy built assets and serve script
COPY --from=builder /app/dist ./dist
COPY employer-ui/serve.ts ./

EXPOSE 80

CMD ["bun", "serve.ts"]
