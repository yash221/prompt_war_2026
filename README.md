# MindEase — Mental Wellness Companion for Exam Aspirants

A GenAI wellness tool built for **PromptWars · Build with AI**. Students preparing for
high-stakes exams (NEET, JEE, CUET, CAT, GATE, UPSC, boards) log their mood and journal
freely. MindEase reads between the lines to surface hidden stress triggers and emotional
patterns, then offers personalized coping strategies, an adaptive mindfulness exercise,
and warm encouragement. A built-in conversational companion is always available to talk.

---

## 1. Chosen challenge

**Mental Wellness Tracker** — a supportive companion for students under exam pressure.
The persona is an aspirant facing stress, burnout, and self-doubt, who needs more than a
generic mood log: they need something that understands what they wrote and responds with
contextual, empathetic, actionable support.

## 2. Approach and logic

The tool turns open-ended journaling into a structured, caring reflection.

- **Read between the lines.** The student writes freely about their day plus a mood
  rating, exam context, and sleep. An LLM finds the *hidden* triggers and emotional
  patterns underneath, not just the obvious ones, and tailors strategies to exactly what
  was written. The model is constrained to return strict JSON.
- **Deterministic logic where it must be trustworthy.** Two things are decided in Python,
  never by the model:
  1. **The wellness score** — computed from mood, sleep, and stress load, so the number is
     consistent and transparent.
  2. **Crisis detection** — every journal entry and chat message is scanned server-side for
     self-harm signals. If matched, verified India helplines are attached no matter what
     the model returns. Safety is never delegated to a language model.
- **Always-available fallback.** With no API key or on any AI failure, a built-in offline
  engine produces a real reflection from a local knowledge base (trigger rules, coping
  strategies, mindfulness exercises). The crisis check runs offline too, so the tool is
  never unsafe and never errors out.
- **Conversational companion.** A chat mode offers real-time, empathetic support with the
  same AI-first, offline-fallback design.

## 3. How the solution works

```
Browser (single page, two modes: Daily check-in · Companion chat)
   │  mood + free-text journal + exam context
   ▼
POST /api/reflect ─► Flask backend ─► LLM (OpenRouter or Claude)
   │                   │  validates + clamps input (never trusts client)
   │                   │  runs crisis detection in Python (always)
   │                   │  forces structured JSON, computes wellness score
   ◄───────────────────┘  returns a normalized reflection
   ▼
UI renders: crisis support (if needed) · wellness score · noticed triggers
            & patterns · coping strategies · mindfulness exercise · encouragement

POST /api/chat ─► same provider ─► short empathetic replies (+ crisis check)
```

1. The student picks a mood, journals, and clicks **Reflect**.
2. The frontend sends the inputs to `POST /api/reflect`.
3. The backend validates every field, runs server-side crisis detection, then calls the
   LLM with a prompt demanding a strict JSON shape.
4. The backend computes the wellness score deterministically and normalizes the output.
5. The result renders as a reflection. All model-derived text is HTML-escaped before
   display.
6. If step 3 or 4 fails, the frontend silently falls back to the offline engine.
7. The companion chat works the same way via `POST /api/chat`.

### Run it locally

```bash
pip install -r requirements.txt
cp .env.example .env        # paste ONE key (optional — offline mode works without)
python app.py               # http://127.0.0.1:8080
```

### AI provider (optional)

The backend auto-selects a provider by which key is present in `.env`:

| Key in `.env`        | Provider   | Notes                               |
|----------------------|------------|-------------------------------------|
| `OPENROUTER_API_KEY` | OpenRouter | Has free models. Checked first.     |
| `ANTHROPIC_API_KEY`  | Claude     | Strong structured output.           |
| *(none)*             | Offline    | Built-in rule engine; always works. |

Free OpenRouter key: https://openrouter.ai/keys

### Tests

```bash
python -m unittest discover -s tests -v
```

Covers the deterministic logic: wellness scoring thresholds, crisis detection,
input validation/clamping, output normalization, and JSON extraction.

### Deploy (Vercel)

`vercel.json` routes all traffic to the Flask app via `@vercel/python`. Import the repo at
vercel.com, add `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY`) as an environment variable,
and deploy. Without a key it still runs in offline mode.

## 4. Assumptions and scope

- **Not a medical device.** MindEase is a supportive companion, not a diagnosis or a
  substitute for professional care. It never diagnoses and points to human help for
  serious distress.
- **India-focused safety.** Crisis helplines are Indian (Tele-MANAS 14416, iCall, AASRA,
  Vandrevala) and available 24x7 or as noted.
- The wellness score is a transparent heuristic for self-awareness, not a clinical metric.
- The offline engine's knowledge base is curated to cover common exam-stress themes; it is
  not exhaustive.
- Journaling is in English.
- Runs as a single-user app; no accounts or persistence in this challenge scope (each
  check-in is independent).

---

## Project structure

```
app.py            Flask server: routes, provider calls, validation,
                  wellness scoring, crisis detection
index.html        Single-page UI (check-in + companion chat)
static/app.js     UI rendering + offline engine + AI fetch with fallback
static/data.js    Offline knowledge base (triggers, strategies, mindfulness, helplines)
static/style.css  Styling
vercel.json       Vercel @vercel/python deployment config
```

## Design notes (safety + quality)

- **Crisis detection is server-side and provider-independent** — it runs in Python on
  every entry, mirrored in the client for offline safety, and surfaces verified helplines.
- API key stays **server-side**; never sent to the browser.
- **Input validated and clamped** server-side; request body size-capped.
- **Model output HTML-escaped** before rendering (XSS guard).
- **Wellness math is deterministic**, so the score is consistent and explainable.
- **Graceful degradation:** any AI failure falls back to the offline engine.
- **Hardening headers** on every response: Content-Security-Policy (same-origin only),
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, Referrer-Policy,
  Permissions-Policy. Supabase secured with Row Level Security (service key server-side).
- Secrets kept out of git via `.gitignore`; `.env.example` documents setup.

## Performance and accessibility

- **Connection pooling:** a shared `requests.Session` reuses TCP/TLS connections across
  all OpenRouter and Supabase calls; the Anthropic client is a lazy singleton.
- **Static assets cached** (`Cache-Control: public, max-age=86400`).
- **Accessibility:** ARIA roles/state on tabs (`tablist`), the mood picker (`radiogroup`),
  and the chat log (`role="log"`, `aria-live`); visible keyboard-focus rings; decorative
  motion marked `aria-hidden` and disabled under `prefers-reduced-motion`.

## Tests

35 unit + route tests cover the deterministic logic (wellness scoring, crisis detection,
validation, normalization, anonymous-id sanitization, row building) and the HTTP layer
(endpoint validation, security headers, static caching). Run: `python -m unittest discover -s tests -v`.
