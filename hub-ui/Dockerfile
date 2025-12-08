# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first for caching
COPY package.json package-lock.json ./

RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Runtime stage - serve with nginx
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
