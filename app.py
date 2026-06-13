"""
Cooking To-Do Planner — backend.

Serves the single-page app and exposes POST /api/plan, which asks an LLM to
turn the user's day into a structured meal plan. The API key never leaves the
server. Budget feasibility math is done here in Python (deterministic, not
left to the model) so the verdict is always trustworthy.

Provider auto-selection (first key found wins):
  - OPENROUTER_API_KEY  -> OpenRouter (has free models, OpenAI-compatible)
  - ANTHROPIC_API_KEY   -> Claude
  - neither             -> client uses its built-in offline engine

Run:
    pip install -r requirements.txt
    cp .env.example .env   # paste a key
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

app = Flask(__name__, static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024  # cap request body

DIET_LABEL = {
    "vegan": "strictly vegan (no animal products at all)",
    "veg": "vegetarian (no meat/fish/egg; dairy is fine)",
    "egg": "eggetarian (vegetarian plus eggs; no meat/fish)",
    "nonveg": "non-vegetarian (anything goes)",
}

# JSON shape we expect back from the model.
JSON_SHAPE = """{
  "meals": [
    {"slot": "breakfast|lunch|dinner", "name": "Dish name",
     "prep_minutes": 20, "cost_per_serving": 40,
     "ingredients": ["Toor dal 80g", "Rice 100g"]}
  ],
  "substitutions": [
    {"from": "paneer", "swap": "tofu", "note": "cheaper, vegan"}
  ]
}"""

SYSTEM_PROMPT = (
    "You are a practical home-cooking planner for Indian households. "
    "Given a person's day and constraints, you design a realistic cooking to-do list. "
    "Rules: respect the diet strictly; keep each dish within the stated prep-time limit; "
    "tailor dishes to what the person described (energy, schedule, guests, mood, leftovers); "
    "use realistic Indian grocery prices in INR; reuse ingredients across meals so the "
    "grocery list stays short and cheap. "
    "Respond with ONLY a JSON object, no prose, no code fences, matching exactly:\n" + JSON_SHAPE
)

# Anthropic tool schema (forces clean structured output on that provider).
PLAN_TOOL = {
    "name": "emit_cooking_plan",
    "description": "Return the structured cooking to-do plan for the user's day.",
    "input_schema": {
        "type": "object",
        "properties": {
            "meals": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "slot": {"type": "string", "enum": ["breakfast", "lunch", "dinner"]},
                        "name": {"type": "string"},
                        "prep_minutes": {"type": "integer"},
                        "cost_per_serving": {"type": "integer"},
                        "ingredients": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["slot", "name", "prep_minutes", "cost_per_serving", "ingredients"],
                },
            },
            "substitutions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "from": {"type": "string"},
                        "swap": {"type": "string"},
                        "note": {"type": "string"},
                    },
                    "required": ["from", "swap", "note"],
                },
            },
        },
        "required": ["meals", "substitutions"],
    },
}


def build_user_prompt(p):
    meals = ", ".join(p["meals"])
    day = p.get("dayText", "").strip() or "(no extra detail given)"
    return (
        f"Plan these meals: {meals}.\n"
        f"People to cook for: {p['people']}.\n"
        f"Diet: {DIET_LABEL.get(p['diet'], p['diet'])}.\n"
        f"Preferred cuisine: {p['cuisine']}.\n"
        f"Max prep time per meal: {p['maxPrep']} minutes.\n"
        f"Daily food budget for the whole household: INR {p['budget']}.\n\n"
        f"About their day: {day}\n\n"
        f"Design the plan, then give 2-4 useful substitutions (cheaper or dietary)."
    )


# --- provider calls --------------------------------------------------------

def call_openrouter(params):
    r = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {OPENROUTER_KEY}", "Content-Type": "application/json"},
        json={
            "model": OPENROUTER_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": build_user_prompt(params)},
            ],
            "temperature": 0.7,
            "max_tokens": 1500,
            "response_format": {"type": "json_object"},
        },
        timeout=45,
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    return parse_json_block(content)


def call_anthropic(params):
    from anthropic import Anthropic
    client = Anthropic(api_key=ANTHROPIC_KEY)
    resp = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=1500,
        system="You are a practical home-cooking planner for Indian households. Always call emit_cooking_plan.",
        tools=[PLAN_TOOL],
        tool_choice={"type": "tool", "name": "emit_cooking_plan"},
        messages=[{"role": "user", "content": build_user_prompt(params)}],
    )
    block = next((b for b in resp.content if b.type == "tool_use"), None)
    if block is None:
        raise ValueError("model returned no tool output")
    return block.input


def parse_json_block(text):
    """Robustly pull a JSON object out of a model's text reply."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


# --- shaping + budget logic ------------------------------------------------

def assess_budget(per_day_cost, budget):
    """Deterministic budget feasibility logic — not left to the model."""
    ratio = per_day_cost / max(budget, 1)
    if ratio <= 0.85:
        return {"verdict": "Comfortably within budget", "klass": "ok", "ratio": ratio,
                "advice": f"You have about INR {round(budget - per_day_cost)} of headroom per day."}
    if ratio <= 1.0:
        return {"verdict": "Tight but feasible", "klass": "warn", "ratio": ratio,
                "advice": "You're close to the limit. The substitutions below add a safety margin."}
    return {"verdict": "Over budget", "klass": "over", "ratio": ratio,
            "advice": f"Over by ~INR {round(per_day_cost - budget)}/day. Apply the substitutions or drop a premium dish."}


def normalize(tool_input, p):
    """Map model output into the exact shape the frontend renders."""
    people = p["people"]
    plan, grocery_map, total = {}, {}, 0
    for m in tool_input.get("meals", []):
        slot = m.get("slot")
        if slot not in ("breakfast", "lunch", "dinner"):
            continue
        meal_cost = int(m.get("cost_per_serving", 0)) * people
        total += meal_cost
        ingredients = [str(i) for i in m.get("ingredients", [])]
        plan[slot] = {"name": str(m.get("name", "Dish")), "prep": int(m.get("prep_minutes", 0)),
                      "mealCost": meal_cost, "ingredients": ingredients}
        for ing in ingredients:
            key = ing.lower()
            grocery_map.setdefault(key, {"label": ing, "count": 0})
            grocery_map[key]["count"] += 1

    grocery = []
    for item in sorted(grocery_map.values(), key=lambda x: x["label"].lower()):
        scale = f" x{people}" if people > 1 else ""
        used = f" (used in {item['count']} dishes)" if item["count"] > 1 else ""
        grocery.append(f"{item['label']}{scale}{used}")

    budget = assess_budget(total, p["budget"])
    budget.update({"perDayCost": total, "dailyBudget": p["budget"]})

    return {
        "input": {"people": people, "budget": p["budget"]},
        "plan": plan,
        "grocery": grocery,
        "subs": [{"from": str(s.get("from", "")), "swap": str(s.get("swap", "")), "note": str(s.get("note", ""))}
                 for s in tool_input.get("substitutions", [])],
        "budget": budget,
        "source": "ai",
    }


def validate(data):
    """Server-side validation/clamping. Never trust the client."""
    if not isinstance(data, dict):
        raise ValueError("bad payload")
    meals = [m for m in ("breakfast", "lunch", "dinner") if data.get(m)]
    if not meals:
        raise ValueError("pick at least one meal")
    diet = data.get("diet") if data.get("diet") in DIET_LABEL else "veg"
    return {
        "people": min(max(int(data.get("people", 1)), 1), 12),
        "budget": min(max(int(data.get("budget", 200)), 1), 100000),
        "maxPrep": min(max(int(data.get("maxPrep", 45)), 5), 180),
        "diet": diet,
        "cuisine": str(data.get("cuisine", "indian"))[:30],
        "meals": meals,
        "dayText": str(data.get("dayText", ""))[:600],
    }


# --- routes ----------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(".", "index.html")


@app.route("/static/<path:fname>")
def static_files(fname):
    return send_from_directory("static", fname)


@app.route("/api/health")
def health():
    return jsonify({"ai": bool(PROVIDER), "provider": PROVIDER, "model": ACTIVE_MODEL})


@app.route("/api/plan", methods=["POST"])
def plan():
    if not PROVIDER:
        return jsonify({"error": "ai_unavailable"}), 503

    try:
        params = validate(request.get_json(force=True, silent=True) or {})
    except (ValueError, TypeError) as e:
        return jsonify({"error": "bad_request", "detail": str(e)}), 400

    try:
        tool_input = call_openrouter(params) if PROVIDER == "openrouter" else call_anthropic(params)
        result = normalize(tool_input, params)
        if not result["plan"]:
            raise ValueError("empty plan")
        return jsonify(result)
    except Exception as e:  # any failure -> client falls back to offline engine
        app.logger.warning("AI call failed (%s): %s", PROVIDER, e)
        return jsonify({"error": "ai_error", "detail": str(e)[:200]}), 502


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    status = f"{PROVIDER} ({ACTIVE_MODEL})" if PROVIDER else "off — offline fallback"
    print(f"  Cooking To-Do Planner on http://127.0.0.1:{port}   AI: {status}")
    app.run(host="127.0.0.1", port=port, debug=False)
