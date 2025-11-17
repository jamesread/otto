# Build stage
FROM node:20-alpine AS builder

WORKDIR /build

# Copy package files
COPY frontend/package.json frontend/package-lock.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built files to nginx html directory
COPY --from=builder /build/dist /app

# Create nginx configuration to serve from /app
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /app; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

