# BilalAI — Base44 Dev Notes

## What this is
A pure static frontend app (Turkish-language "AI" chat interface). No build step, no backend, no database, no external API calls. All "AI" responses are generated client-side by local JS engines in `model.js`, `flashlitemodel.js`, and `pro-model.js`.

## How it runs
Served as static files by `nginx:alpine` via `docker-compose.base44.yml` on host port 3000. The repo root is bind-mounted read-only into nginx's html directory, so edits appear on reload.

## Files
- `index.html` — main UI (chat interface, sidebar, theme toggle)
- `style.css` — all styling
- `script.js` — app logic (chat management, rendering, model switching)
- `model.js` — BilalAI Flash 1.1 response engine
- `flashlitemodel.js` — FlashLite response engine
- `pro-model.js` — Pro model stub
- `main.js` — Electron desktop wrapper (not used in web preview)

## Verification
- `curl -s http://localhost:3000/` returns the HTML page with `<title>BilalAI</title>`
- No secrets or credentials required.
