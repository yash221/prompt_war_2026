"""
MindEase - Mental Wellness Companion for exam aspirants. Backend.

Serves the single-page app and exposes two endpoints:
  POST /api/reflect  -> turns a daily journal + mood log into a structured
                        wellness reflection (triggers, patterns, coping
                        strategies, a mindfulness exercise, encouragement).
  POST /api/chat     -> conversational companion replies.

Two things are deliberately done in Python, never left to the model, so they
stay trustworthy:
  1. The wellness score (deterministic math from mood + sleep + trigger load).
  2. Crisis detection. Every user message is scanned server-side for
     self-harm signals; if matched we attach verified helpline info no matter
     what the model says. Safety is not delegated to a language model.

The API key never leaves the server.

Provider auto-selection (first key found wins):
  - OPENROUTER_API_KEY  -> OpenRouter (has free models, OpenAI-compatible)
  - ANTHROPIC_API_KEY   -> Claude
  - neither             -> client uses its built-in offline engine

Run:
    pip install -r requirements.txt
    cp .env.example .env   # paste a key (optional; offline mode works without)
    python app.py
"""

import json
import os
import re

import requests
from flask import Flask, request, jsonify, send_from_directory
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY")
ANTHROPIC_KEY = os.getenv("ANTHROPIC_API_KEY")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")

if OPENROUTER_KEY:
    PROVIDER, ACTIVE_MODEL = "openrouter", OPENROUTER_MODEL
elif ANTHROPIC_KEY:
    PROVIDER, ACTIVE_MODEL = "anthropic", ANTHROPIC_MODEL
else:
    PROVIDER, ACTIVE_MODEL = None, None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Optional Supabase persistence (Postgres via its REST API). When the env vars
# are absent the app runs exactly as before; storage just no-ops and the client
# keeps history in localStorage instead.
SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
DB_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)

app = Flask(__name__, static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024  # cap request body

EXAM_LABEL = {
    "neet": "NEET (medical entrance)",
    "jee": "JEE (engineering entrance)",
    "cuet": "CUET (university entrance)",
    "cat": "CAT (MBA entrance)",
    "gate": "GATE (engineering postgrad)",
    "upsc": "UPSC (civil services)",
    "boards": "Class 10/12 board exams",
    "other": "a high-stakes exam",
}

# --- crisis detection (server-side, never delegated to the model) ----------

# Verified India helplines (24x7). Shown whenever crisis signals are detected.
HELPLINES = [
    {"name": "Tele-MANAS (Govt. of India)", "contact": "14416 / 1-800-891-4416", "note": "24x7 mental health support"},
    {"name": "iCall (TISS)", "contact": "9152987821", "note": "Mon-Sat, 8am-10pm, counselling"},
    {"name": "AASRA", "contact": "9820466726", "note": "24x7 suicide prevention"},
    {"name": "Vandrevala Foundation", "contact": "1860-2662-345", "note": "24x7 free counselling"},
]

CRISIS_PATTERNS = [
    r"\bkill (myself|me)\b", r"\bend (my|this) life\b", r"\bwant to die\b",
    r"\bwanna die\b", r"\bsuicid", r"\bself[\s-]?harm", r"\bhurt(ing)? myself\b",
    r"\bcut(ting)? myself\b", r"\bno reason to live\b", r"\bdon'?t want to live\b",
    r"\bcan'?t go on\b", r"\bend it all\b", r"\bbetter off dead\b",
    r"\bno point (in )?living\b", r"\btake my (own )?life\b", r"\bgive up on life\b",
]
CRISIS_RE = re.compile("|".join(CRISIS_PATTERNS), re.IGNORECASE)


def detect_crisis(text):
    """Return a safety object. Crisis flag is decided by Python, not the LLM."""
    if text and CRISIS_RE.search(text):
        return {
            "crisis": True,
            "message": (
                "It sounds like you're carrying something really heavy right now, and "
                "you don't have to carry it alone. Please reach out to someone who can "
                "support you right away. You matter far more than any exam."
            ),
            "helplines": HELPLINES,
        }
    return {"crisis": False}


# --- reflect: prompts + schema --------------------------------------------

JSON_SHAPE = """{
  "emotion": "short label for how they feel, e.g. 'anxious and self-critical'",
  "triggers": [
    {"label": "Falling behind on the syllabus", "category": "academic"}
  ],
  "patterns": "1-2 sentences naming an emotional pattern they may not see themselves",
  "strategies": [
    {"title": "Short actionable strategy", "detail": "one concrete sentence on how"}
  ],
  "mindfulness": {
    "name": "Exercise name",
    "duration": "3 min",
    "steps": ["step one", "step two", "step three"]
  },
  "encouragement": "one warm, specific motivational paragraph (2-3 sentences)"
}"""

SYSTEM_PROMPT = (
    "You are MindEase, a warm, empathetic wellness companion for Indian students "
    "preparing for high-stakes exams (NEET, JEE, CUET, CAT, GATE, UPSC, boards). "
    "You are NOT a doctor or therapist and you never diagnose. You read a student's "
    "daily journal and mood, then reflect back what you notice with compassion. "
    "Find the HIDDEN stress triggers and emotional patterns beneath the surface, not "
    "just the obvious ones. Give coping strategies that are concrete and doable today, "
    "tailored to exactly what they wrote. Pick a mindfulness exercise that fits their "
    "current mood. Always be validating and hopeful, never preachy or generic. "
    "If they express thoughts of self-harm, gently urge them to reach out for human "
    "support. Respond with ONLY a JSON object, no prose, no code fences, matching "
    "exactly:\n" + JSON_SHAPE
)

REFLECT_TOOL = {
    "name": "emit_reflection",
    "description": "Return the structured wellness reflection for the student's check-in.",
    "input_schema": {
        "type": "object",
        "properties": {
            "emotion": {"type": "string"},
            "triggers": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "category": {"type": "string"},
                    },
                    "required": ["label", "category"],
                },
            },
            "patterns": {"type": "string"},
            "strategies": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "detail": {"type": "string"},
                    },
                    "required": ["title", "detail"],
                },
            },
            "mindfulness": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "duration": {"type": "string"},
                    "steps": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "duration", "steps"],
            },
            "encouragement": {"type": "string"},
        },
        "required": ["emotion", "triggers", "patterns", "strategies", "mindfulness", "encouragement"],
    },
}


def build_reflect_prompt(p):
    days = p["daysToExam"]
    days_txt = f"{days} days away" if days else "not specified"
    sleep_txt = f"{p['sleepHours']} hours" if p["sleepHours"] is not None else "not specified"
    return (
        f"A student preparing for {EXAM_LABEL.get(p['exam'], p['exam'])} wrote today's check-in.\n"
        f"Mood (1 = very low, 5 = great): {p['mood']}\n"
        f"Exam is: {days_txt}\n"
        f"Sleep last night: {sleep_txt}\n\n"
        f"Their journal entry:\n\"\"\"\n{p['journal']}\n\"\"\"\n\n"
        f"Reflect with empathy. Surface the hidden triggers and the emotional pattern "
        f"underneath, give 3-4 coping strategies for THIS exact situation, one short "
        f"mindfulness exercise suited to their mood, and a warm motivational message."
    )


# --- chat: companion -------------------------------------------------------

CHAT_SYSTEM = (
    "You are MindEase, a warm, always-available wellness companion for Indian students "
    "preparing for high-stakes exams. Talk like a caring, grounded friend who happens "
    "to know about stress and study burnout. You are NOT a therapist and never diagnose; "
    "for anything serious you gently encourage reaching out to a trusted person or a "
    "helpline. Keep replies short (2-5 sentences), validating, and practical. Offer one "
    "small, doable suggestion when it helps. Never lecture. Never dismiss feelings."
)


# --- provider calls --------------------------------------------------------

def call_openrouter_json(system, user_prompt):
    r = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
        json={
            "model": OPENROUTER_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.7,
            "max_tokens": 1200,
            "response_format": {"type": "json_object"},
        },
        timeout=45,
    )
    r.raise_for_status()
    return parse_json_block(r.json()["choices"][0]["message"]["content"])


def call_anthropic_reflect(params):
    from anthropic import Anthropic
    client = Anthropic(api_key=ANTHROPIC_KEY)
    resp = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=1200,
        system=SYSTEM_PROMPT,
        tools=[REFLECT_TOOL],
        tool_choice={"type": "tool", "name": "emit_reflection"},
        messages=[{"role": "user", "content": build_reflect_prompt(params)}],
    )
    block = next((b for b in resp.content if b.type == "tool_use"), None)
    if block is None:
        raise ValueError("model returned no tool output")
    return block.input


def call_openrouter_chat(messages):
    r = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
        json={
            "model": OPENROUTER_MODEL,
            "messages": [{"role": "system", "content": CHAT_SYSTEM}] + messages,
            "temperature": 0.8,
            "max_tokens": 350,
        },
        timeout=45,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"].strip()


def call_anthropic_chat(messages):
    from anthropic import Anthropic
    client = Anthropic(api_key=ANTHROPIC_KEY)
    resp = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=350,
        system=CHAT_SYSTEM,
        messages=messages,
    )
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def parse_json_block(text):
    """Robustly pull a JSON object out of a model's text reply."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


# --- deterministic wellness scoring ----------------------------------------

def assess_wellness(mood, sleep_hours, trigger_count):
    """Wellness score from mood + sleep + stress load. Deterministic, not LLM."""
    base = {1: 25, 2: 42, 3: 60, 4: 76, 5: 90}.get(mood, 60)

    if sleep_hours is not None:
        if sleep_hours < 5:
            base -= 12
        elif sleep_hours < 6:
            base -= 6
        elif sleep_hours >= 7:
            base += 4

    # Each trigger beyond the first chips away at the score, capped.
    base -= min(max(trigger_count - 1, 0) * 4, 16)

    score = max(5, min(100, base))

    if score >= 75:
        state, klass = "Steady", "ok"
        advice = "You're holding up well. Keep protecting the habits that are working for you."
    elif score >= 55:
        state, klass = "Managing", "ok"
        advice = "You're coping, with some strain. The strategies below can give you a bit more breathing room."
    elif score >= 35:
        state, klass = "Strained", "warn"
        advice = "Stress is running high. Be gentle with yourself today and try one small reset below."
    else:
        state, klass = "Overwhelmed", "over"
        advice = "You're carrying a lot right now. Please go easy on yourself, and consider talking to someone you trust."

    return {"score": score, "state": state, "klass": klass, "advice": advice}


def normalize(tool_input, p, safety):
    """Map model output into the exact shape the frontend renders, add wellness."""
    triggers = []
    for t in tool_input.get("triggers", []):
        if isinstance(t, dict) and t.get("label"):
            triggers.append({"label": str(t["label"]), "category": str(t.get("category", "general"))})

    strategies = []
    for s in tool_input.get("strategies", []):
        if isinstance(s, dict) and s.get("title"):
            strategies.append({"title": str(s["title"]), "detail": str(s.get("detail", ""))})

    mind = tool_input.get("mindfulness", {}) or {}
    mindfulness = {
        "name": str(mind.get("name", "Box breathing")),
        "duration": str(mind.get("duration", "3 min")),
        "steps": [str(x) for x in mind.get("steps", [])][:8] or [
            "Breathe in slowly for 4 counts.", "Hold for 4.", "Breathe out for 4.", "Repeat for a few rounds."
        ],
    }

    wellness = assess_wellness(p["mood"], p["sleepHours"], len(triggers))

    return {
        "emotion": str(tool_input.get("emotion", "")),
        "triggers": triggers,
        "patterns": str(tool_input.get("patterns", "")),
        "strategies": strategies,
        "mindfulness": mindfulness,
        "encouragement": str(tool_input.get("encouragement", "")),
        "wellness": wellness,
        "safety": safety,
        "source": "ai",
    }


def validate_reflect(data):
    """Server-side validation/clamping. Never trust the client."""
    if not isinstance(data, dict):
        raise ValueError("bad payload")
    journal = str(data.get("journal", "")).strip()
    if len(journal) < 3:
        raise ValueError("write a little about your day first")

    sleep = data.get("sleepHours", None)
    try:
        sleep = None if sleep in (None, "") else min(max(float(sleep), 0), 24)
    except (ValueError, TypeError):
        sleep = None

    days = data.get("daysToExam", None)
    try:
        days = None if days in (None, "") else min(max(int(days), 0), 2000)
    except (ValueError, TypeError):
        days = None

    exam = data.get("exam") if data.get("exam") in EXAM_LABEL else "other"
    return {
        "mood": min(max(int(data.get("mood", 3)), 1), 5),
        "journal": journal[:2000],
        "exam": exam,
        "daysToExam": days,
        "sleepHours": sleep,
    }


# --- storage (Supabase REST, best-effort) ----------------------------------

def clean_anon_id(value):
    """An anonymous per-browser id. Sanitized; never trusted as-is."""
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "", str(value or ""))[:64]
    return cleaned or None


def _int_or_none(value):
    try:
        return None if value in (None, "") else int(value)
    except (ValueError, TypeError):
        return None


def _float_or_none(value):
    try:
        return None if value in (None, "") else float(value)
    except (ValueError, TypeError):
        return None


def build_checkin_row(anon_id, inp, res):
    """Shape a stored row from the input + rendered result. Pure (testable)."""
    inp = inp or {}
    res = res or {}
    wellness = res.get("wellness") or {}
    safety = res.get("safety") or {}
    triggers = [t for t in (res.get("triggers") or []) if isinstance(t, dict)][:12]
    return {
        "anon_id": anon_id,
        "mood": min(max(_int_or_none(inp.get("mood")) or 3, 1), 5),
        "exam": str(inp.get("exam", ""))[:20],
        "days_to_exam": _int_or_none(inp.get("daysToExam")),
        "sleep_hours": _float_or_none(inp.get("sleepHours")),
        "journal": str(inp.get("journal", ""))[:2000],
        "emotion": str(res.get("emotion", ""))[:120],
        "wellness_score": min(max(_int_or_none(wellness.get("score")) or 0, 0), 100),
        "wellness_state": str(wellness.get("state", ""))[:30],
        "triggers": triggers,
        "source": str(res.get("source", ""))[:16],
        "crisis": bool(safety.get("crisis")),
    }


def _sb_headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}


def store_checkin(row):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/checkins",
        headers={**_sb_headers(), "Prefer": "return=minimal"},
        json=row, timeout=8,
    )
    r.raise_for_status()


def fetch_history(anon_id, limit=30):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/checkins",
        headers=_sb_headers(),
        params={
            "anon_id": f"eq.{anon_id}",
            "order": "created_at.desc",
            "limit": str(limit),
            "select": "created_at,mood,emotion,wellness_score,wellness_state,triggers,source,crisis",
        },
        timeout=8,
    )
    r.raise_for_status()
    return r.json()


# --- routes ----------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/static/<path:fname>")
def static_files(fname):
    return send_from_directory(os.path.join(BASE_DIR, "static"), fname)


@app.route("/api/health")
def health():
    return jsonify({"ai": bool(PROVIDER), "provider": PROVIDER, "model": ACTIVE_MODEL, "db": DB_ENABLED})


@app.route("/api/checkins", methods=["GET", "POST"])
def checkins():
    if request.method == "GET":
        anon = clean_anon_id(request.args.get("anon_id"))
        if not DB_ENABLED or not anon:
            return jsonify({"items": [], "db": DB_ENABLED})
        try:
            return jsonify({"items": fetch_history(anon), "db": True})
        except Exception as e:
            app.logger.warning("history fetch failed: %s", e)
            return jsonify({"items": [], "db": True, "error": "fetch_failed"})

    # POST: persist one check-in (best-effort; never breaks the UX).
    body = request.get_json(force=True, silent=True) or {}
    anon = clean_anon_id(body.get("anon_id"))
    if not anon:
        return jsonify({"stored": False, "reason": "no_anon_id"}), 400
    if not DB_ENABLED:
        return jsonify({"stored": False, "reason": "db_disabled"})
    try:
        store_checkin(build_checkin_row(anon, body.get("input"), body.get("result")))
        return jsonify({"stored": True})
    except Exception as e:
        app.logger.warning("checkin store failed: %s", e)
        return jsonify({"stored": False, "reason": "store_failed"})


@app.route("/api/reflect", methods=["POST"])
def reflect():
    try:
        params = validate_reflect(request.get_json(force=True, silent=True) or {})
    except (ValueError, TypeError) as e:
        return jsonify({"error": "bad_request", "detail": str(e)}), 400

    # Crisis check runs regardless of provider/model, on the raw journal text.
    safety = detect_crisis(params["journal"])

    if not PROVIDER:
        return jsonify({"error": "ai_unavailable", "safety": safety}), 503

    try:
        tool_input = (
            call_openrouter_json(SYSTEM_PROMPT, build_reflect_prompt(params))
            if PROVIDER == "openrouter" else call_anthropic_reflect(params)
        )
        result = normalize(tool_input, params, safety)
        if not result["strategies"] and not result["triggers"]:
            raise ValueError("empty reflection")
        return jsonify(result)
    except Exception as e:  # any failure -> client falls back to offline engine
        app.logger.warning("AI reflect failed (%s): %s", PROVIDER, e)
        return jsonify({"error": "ai_error", "detail": str(e)[:200], "safety": safety}), 502


@app.route("/api/chat", methods=["POST"])
def chat():
    body = request.get_json(force=True, silent=True) or {}
    raw = body.get("messages", [])
    # Keep only well-formed turns, last 12, cap each message length.
    messages = []
    for m in raw[-12:]:
        if isinstance(m, dict) and m.get("role") in ("user", "assistant") and m.get("content"):
            messages.append({"role": m["role"], "content": str(m["content"])[:1500]})
    if not messages or messages[-1]["role"] != "user":
        return jsonify({"error": "bad_request", "detail": "no user message"}), 400

    safety = detect_crisis(messages[-1]["content"])

    if not PROVIDER:
        return jsonify({"error": "ai_unavailable", "safety": safety}), 503

    try:
        reply = call_openrouter_chat(messages) if PROVIDER == "openrouter" else call_anthropic_chat(messages)
        if not reply:
            raise ValueError("empty reply")
        return jsonify({"reply": reply, "safety": safety, "source": "ai"})
    except Exception as e:
        app.logger.warning("AI chat failed (%s): %s", PROVIDER, e)
        return jsonify({"error": "ai_error", "detail": str(e)[:200], "safety": safety}), 502


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    status = f"{PROVIDER} ({ACTIVE_MODEL})" if PROVIDER else "off - offline fallback"
    db = "on (Supabase)" if DB_ENABLED else "off - localStorage only"
    print(f"  MindEase wellness companion on http://127.0.0.1:{port}   AI: {status}   DB: {db}")
    app.run(host="127.0.0.1", port=port, debug=False)
