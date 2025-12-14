# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy specs first (needed for vetchium-specs dependency)
COPY specs/typespec /specs/typespec

# Copy package files first for caching
COPY hub-ui/package.json hub-ui/package-lock.json ./

RUN npm ci

# Copy source code
COPY hub-ui/ .

# Build the app
RUN npm run build

# Runtime stage - serve with nginx
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config for SPA routing
COPY hub-ui/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
