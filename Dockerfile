# Builds the React frontend and the Go server into one small image.
#
#   docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_live_... -t mayelai .
#   docker run -p 8080:8080 --env-file server/.env mayelai

# --- 1. Frontend ---
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js components.json ./
COPY public ./public
COPY src ./src
# The publishable key is public (it ships in the browser bundle), so a build arg is fine.
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN npm run build

# --- 2. Backend ---
FROM golang:1.26-alpine AS api
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server .

# --- 3. Runtime (no shell, runs as non-root; includes CA certificates) ---
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=api /out/server /app/server
COPY --from=web /app/dist /app/dist
ENV PORT=8080 STATIC_DIR=/app/dist
EXPOSE 8080
ENTRYPOINT ["/app/server"]
