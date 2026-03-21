# Crucible — Radiology Training Platform
> *Mastery is forged under pressure*

## Prerequisites
- [Node.js 18+](https://nodejs.org/) installed
- [Git](https://git-scm.com/) installed
- A free [Netlify account](https://netlify.com)
- Your Anthropic API key

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Install Netlify CLI globally (once)
npm install -g netlify-cli

# 3. Create a local environment file
echo 'ANTHROPIC_API_KEY=your_key_here' > .env

# 4. Run locally (Netlify Dev runs both Vite + serverless functions)
netlify dev
```

Open http://localhost:8888 — dictation and AI feedback both work locally.

---

## Deploy to Netlify

### Option A — Netlify CLI (fastest)

```bash
# Login to Netlify
netlify login

# Deploy (first time — creates a new site)
netlify deploy --build

# Follow the prompts, then promote to production:
netlify deploy --build --prod
```

### Option B — GitHub + Netlify UI (recommended for ongoing updates)

1. Push this folder to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial Crucible deploy"
   git remote add origin https://github.com/YOUR_USERNAME/crucible.git
   git push -u origin main
   ```

2. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import from Git**

3. Select your repository → Netlify auto-detects the build settings from `netlify.toml`

4. Click **Deploy site**

### Set the API Key (required)

In Netlify dashboard:  
**Site settings → Environment variables → Add variable**

| Key                  | Value                    |
|----------------------|--------------------------|
| `ANTHROPIC_API_KEY`  | `sk-ant-...your key...`  |

Then trigger a redeploy: **Deploys → Trigger deploy → Deploy site**

---

## Architecture

```
Browser (React + Vite)
    │
    ├── Web Speech API          ← dictation (native, no cost)
    │
    └── POST /api/messages      ← all AI calls (evaluation, fix terms, conversion)
              │
        Netlify Function        ← adds API key, proxies to Anthropic
              │
        Anthropic API (Haiku)
```

The API key never reaches the browser. All Anthropic calls go through
`netlify/functions/api.js`.

---

## Future: Deepgram Medical Dictation

When you're ready to upgrade dictation accuracy, replace the Web Speech API
with Deepgram's medical model:

1. Add `DEEPGRAM_API_KEY` to Netlify environment variables
2. Add a `netlify/functions/deepgram-token.js` function that issues
   temporary Deepgram tokens (so the Deepgram key also stays server-side)
3. Swap the `startDictation` function in `src/App.jsx` to use
   Deepgram's WebSocket SDK

This is a self-contained change — nothing else in the app needs to change.

---

## Prototype vs Production Image Note

Cases marked `useClass: "prototype"` in `src/App.jsx` display a warning
banner and must not be included in any commercial release. Before any
production launch, audit all cases and remove or replace prototype images.
