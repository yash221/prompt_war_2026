# Cooking To-Do Planner

A small AI micro-app for **PromptWars · Build with AI**. You describe your day and your
constraints (people, budget, diet, cuisine, time); it generates a structured cooking
to-do list: **Breakfast / Lunch / Dinner plan, grocery list, substitutions, and a
budget feasibility verdict.**

## Run it

```bash
pip install -r requirements.txt
cp .env.example .env        # paste ONE key (see below) — or skip for offline mode
python app.py               # http://127.0.0.1:8080
```

## AI provider (pick one, or none)

The backend auto-selects a provider by which key is in `.env`:

| Key in `.env`         | Provider   | Notes                                  |
|-----------------------|------------|----------------------------------------|
| `OPENROUTER_API_KEY`  | OpenRouter | Has **free** models. Checked first.    |
| `ANTHROPIC_API_KEY`   | Claude     | Best structured output.                |
| *(none)*              | Offline    | Built-in rule engine, always works.    |

Free OpenRouter key: https://openrouter.ai/keys

## How it's built

- `app.py` — Flask. Serves the page + `POST /api/plan`. The API key stays server-side.
- `static/data.js` — recipe knowledge base (offline engine).
- `static/app.js` — UI + offline engine + AI fetch with automatic fallback.
- `static/style.css` — UI.

## Design notes (quality + security)

- **Key never reaches the browser.** All model calls are server-side.
- **Budget math is deterministic** in Python, not left to the model, so the verdict
  is always correct even if the model misjudges costs.
- **Inputs are validated and clamped** server-side; request body is size-capped.
- **Graceful degradation:** any AI failure (no key, network, bad output) silently
  falls back to the offline engine, so a live demo never shows an error screen.
- **No secrets in git:** `.env` is gitignored; `.env.example` documents setup.
