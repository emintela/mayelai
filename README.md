# Mayel AI

A React (Vite) single-page app with a small Express backend that hosts the API routes calling OpenAI, LangChain, and SerpAPI.

## Project layout

- `src/` — React frontend (Vite, React Router, Tailwind v4, Clerk auth via `@clerk/clerk-react`)
- `server/` — Express backend (`/api/chat`, `/api/ai-agent`, `/api/langchain-search`, `/api/web-search`), keeps secret API keys server-side

## Getting started

Install dependencies for both the frontend and the backend:

```bash
npm install
npm install --prefix server
```

Set environment variables:

- `.env` (root) — `VITE_CLERK_PUBLISHABLE_KEY`
- `server/.env` — `OPENAI_API_KEY`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `SERPAPI_KEY`

Run both the frontend (http://localhost:5173) and backend (http://localhost:3001) together:

```bash
npm run dev
```

The Vite dev server proxies `/api/*` requests to the Express server, so the frontend can keep calling relative paths like `axios.post("/api/chat", ...)`.

## Build

```bash
npm run build
```

Produces a static build in `dist/`. In production you'll need to serve `dist/` and run `server/` behind a reverse proxy (or configure the frontend's API base URL to point at wherever the Express server is deployed) — the Vite dev proxy only applies to `npm run dev`.
