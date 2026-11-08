# Mayel AI

A React (Vite) single-page app with a small Go ([Fiber](https://gofiber.io)) backend that hosts the API routes calling OpenAI and SerpAPI.

## Project layout

- `src/` — React frontend (Vite, React Router, Tailwind v4, Clerk auth via `@clerk/clerk-react`)
- `server/` — Go + Fiber backend (`/api/chat`, `/api/ai-agent`, `/api/langchain-search`, `/api/web-search`), keeps secret API keys server-side
  - `main.go` — app setup and routing
  - `internal/auth` — Clerk session-token verification middleware
  - `internal/openai` — minimal OpenAI Chat Completions client
  - `internal/routes` — route handlers

## Getting started

Requires Node.js (frontend) and Go 1.26+ (backend).

```bash
npm install
cd server && go mod download
```

Set environment variables:

- `.env` (root) — `VITE_CLERK_PUBLISHABLE_KEY`
- `server/.env` — `OPENAI_API_KEY`, `CLERK_SECRET_KEY`, `SERPAPI_KEY`, optional `PORT` (default `3001`)

Run both the frontend (http://localhost:5173) and backend (http://localhost:3001) together:

```bash
npm run dev
```

The Vite dev server proxies `/api/*` requests to the Go server, so the frontend can keep calling relative paths like `axios.post("/api/chat", ...)`.

## Build

```bash
npm run build                          # static frontend in dist/
cd server && go build -o mayelai-server .   # single backend binary
```

In production, serve `dist/` and run the server binary behind a reverse proxy (or point the frontend's API base URL at wherever the server is deployed) — the Vite dev proxy only applies to `npm run dev`.
