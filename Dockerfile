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

# Production stage — unprivileged nginx (non-root, temp paths under /tmp)
FROM nginxinc/nginx-unprivileged:alpine

COPY --from=builder --chown=101:101 /build/dist /usr/share/nginx/html
COPY docker/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# With readOnlyRootFilesystem, mount a writable emptyDir (or tmpfs) on /tmp.
CMD ["nginx", "-g", "daemon off;"]
