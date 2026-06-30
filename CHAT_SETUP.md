# Site Chat Assistant ("Ada") — Setup

A floating chat widget on the public homepage that's an expert on UMOF and the
Funding Masterclass. It answers visitors' questions and, for anything it can't
confidently answer, points them to **info@umof.org**.

## How it works

- **Widget** (`src/chat/widget.js` + `src/chat/chat.css`) — the bubble in the
  bottom-right corner. Loaded from `src/main.js`, so it appears on `index.html`
  (the public site) only, not the gated `portal.html`.
- **Serverless proxy** (`api/chat.js`) — a Vercel function that holds your
  Gemini API key and the class knowledge base, then calls Google's Gemini API.
  **The key never reaches the browser.**

The knowledge base (everything the assistant knows about the program — schedule,
tuition, pillars, certificate, funding benefit, etc.) lives in the
`KNOWLEDGE_BASE` string at the top of `api/chat.js`. Edit that string whenever
the class details change.

## 1. Get a Google AI Studio (Gemini) API key

1. Go to https://aistudio.google.com/apikey
2. Create an API key (the free tier is plenty for a site assistant).

## 2. Add the key to Vercel

In the Vercel dashboard → your project → **Settings → Environment Variables**:

| Name             | Value                         | Environments              |
| ---------------- | ----------------------------- | ------------------------- |
| `GEMINI_API_KEY` | *(your AI Studio key)*        | Production, Preview, Dev  |
| `GEMINI_MODEL`   | `gemini-2.5-flash` *(optional)* | Production, Preview, Dev |

> ⚠️ Do **not** name it `VITE_GEMINI_API_KEY`. Anything prefixed with `VITE_`
> gets baked into the public JavaScript bundle. This key must stay server-side.

Redeploy after adding the variable so the function picks it up.

That's it — Vercel automatically deploys files in `/api` as serverless
functions for Vite projects, so no `vercel.json` changes are needed.

## 3. Test locally (optional)

`npm run dev` (Vite) serves the site but **not** the `/api` function — so the
widget will show its graceful fallback ("please email info@umof.org"). To run
the function locally too, use the Vercel CLI:

```bash
npm i -g vercel
vercel link            # once, to link this folder to your Vercel project
vercel env pull .env   # pulls GEMINI_API_KEY into a local .env (git-ignored)
vercel dev             # serves the site AND /api/chat together
```

## Customizing

- **What it knows** — edit `KNOWLEDGE_BASE` in `api/chat.js`.
- **Fallback email** — `CONTACT_EMAIL` constant (in both `api/chat.js` and
  `src/chat/widget.js`).
- **Greeting & suggested questions** — `GREETING` and `SUGGESTIONS` in
  `src/chat/widget.js`.
- **Colors** — the widget reuses the brand tokens (`--maroon`, etc.) from
  `src/style.css`.
- **Model** — set `GEMINI_MODEL` (defaults to `gemini-2.5-flash`).

## Cost & limits

Gemini's free tier has per-minute and per-day request limits. The function caps
message length and conversation history to keep requests small. If the site gets
heavy traffic you may want to add rate limiting or upgrade the Gemini plan.
