/*
 * MannMitra engine — pure client-side logic with no DOM access.
 * Holds helpers, crisis detection, local/remote storage, the offline reflection
 * engine, the network calls, and the offline chat fallback. All DOM rendering
 * lives in app.js. Loaded after data.js and before app.js.
 */

// --- helpers ---------------------------------------------------------------

// Escape any model/user-derived text before it goes into innerHTML (XSS guard).
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function num(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : 0;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Crisis detection, mirrored from the backend so offline mode is also safe.
function detectCrisis(text) {
  if (text && CRISIS_RE.test(text)) {
    return { crisis: true, message: CRISIS_MESSAGE, helplines: HELPLINES };
  }
  return { crisis: false };
}

// --- storage (server via Supabase + localStorage mirror) -------------------

const LS_HISTORY = "mannmitra_history";
const MOOD_EMOJI = { 1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "😄" };

// One stable anonymous id per browser, so history is "yours" without a login.
function getAnonId() {
  let id = localStorage.getItem("mannmitra_id");
  if (!id) {
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : "u-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("mannmitra_id", id);
  }
  return id;
}

function localHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) || "[]"); }
  catch (e) { return []; }
}

function pushLocalHistory(entry) {
  const all = localHistory();
  all.unshift(entry);
  localStorage.setItem(LS_HISTORY, JSON.stringify(all.slice(0, 60)));
}

// Save a check-in: always to localStorage, and to the server when DB is on.
async function saveCheckin(input, result) {
  pushLocalHistory({
    created_at: new Date().toISOString(),
    mood: input.mood,
    emotion: result.emotion,
    wellness_score: result.wellness.score,
    wellness_state: result.wellness.state,
    triggers: result.triggers,
    source: result.source,
    crisis: !!(result.safety && result.safety.crisis),
  });
  try {
    await fetch("/api/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anon_id: getAnonId(), input, result }),
    });
  } catch (e) { /* offline: localStorage already has it */ }
}

// --- offline reflection engine (mirrors the backend) -----------------------
// These scoring constants mirror assess_wellness() in app.py exactly so the
// offline engine and the server produce identical scores. Change both together.

const MOOD_BASE_SCORE = { 1: 25, 2: 42, 3: 60, 4: 76, 5: 90 };
const DEFAULT_BASE_SCORE = 60;
const SLEEP_PENALTY_SEVERE = 12;  // under 5 hours
const SLEEP_PENALTY_MILD = 6;     // under 6 hours
const SLEEP_BONUS_RESTED = 4;     // 7 hours or more
const TRIGGER_PENALTY_EACH = 4;   // per stress trigger beyond the first
const TRIGGER_PENALTY_CAP = 16;
const SCORE_MIN = 5, SCORE_MAX = 100;

// Score bands, highest first: [minScore, state, cssClass, advice].
const WELLNESS_BANDS = [
  [75, "Steady", "ok",
    "You're holding up well. Keep protecting the habits that are working for you."],
  [55, "Managing", "ok",
    "You're coping, with some strain. The strategies below can give you a bit more breathing room."],
  [35, "Strained", "warn",
    "Stress is running high. Be gentle with yourself today and try one small reset below."],
  [0, "Overwhelmed", "over",
    "You're carrying a lot right now. Please go easy on yourself, and consider talking to someone you trust."],
];

/**
 * Compute the deterministic wellness score and band from mood, sleep, and load.
 * @param {number} mood - 1 (very low) to 5 (great).
 * @param {?number} sleep - hours slept, or null/NaN if not provided.
 * @param {number} triggerCount - number of detected stress triggers.
 * @returns {{score:number, state:string, klass:string, advice:string}}
 */
function assessWellness(mood, sleep, triggerCount) {
  let base = MOOD_BASE_SCORE[mood] != null ? MOOD_BASE_SCORE[mood] : DEFAULT_BASE_SCORE;

  if (sleep != null && !Number.isNaN(sleep)) {
    if (sleep < 5) base -= SLEEP_PENALTY_SEVERE;
    else if (sleep < 6) base -= SLEEP_PENALTY_MILD;
    else if (sleep >= 7) base += SLEEP_BONUS_RESTED;
  }
  base -= Math.min(Math.max(triggerCount - 1, 0) * TRIGGER_PENALTY_EACH, TRIGGER_PENALTY_CAP);

  const score = Math.max(SCORE_MIN, Math.min(SCORE_MAX, base));
  const [, state, klass, advice] = WELLNESS_BANDS.find(b => score >= b[0]);
  return { score, state, klass, advice };
}

function emotionLabel(mood, cats) {
  if (cats.has("emotional")) return mood <= 2 ? "anxious and overwhelmed" : "anxious but holding on";
  if (cats.has("performance")) return "discouraged and self-critical";
  if (cats.has("family")) return "pressured and worried about others";
  if (cats.has("physical")) return "drained and stretched thin";
  if (cats.has("social")) return "isolated and comparing yourself a lot";
  const base = { 1: "very low", 2: "low and tired", 3: "a bit mixed", 4: "fairly okay", 5: "positive and steady" };
  return base[mood] || "a bit mixed";
}

function buildPattern(triggers, mood) {
  if (!triggers.length) {
    return mood <= 2
      ? "There's a low, heavy feeling running under your words today, even if it's hard to name exactly why."
      : "Things read as relatively steady today. It's worth noticing what's helping, so you can lean on it deliberately.";
  }
  const cats = new Set(triggers.map(t => t.category));
  if (cats.has("performance") || cats.has("social"))
    return "A pattern stands out: you're measuring your worth by results and by how you stack up against others. That comparison is draining more energy than the syllabus itself.";
  if (cats.has("family"))
    return "Underneath the studying, a lot of this seems to be about not wanting to let people down. That's love turning into pressure, and the two are worth separating.";
  if (cats.has("emotional"))
    return "The worry appears to be feeding on itself, racing toward worst-case outcomes faster than any single fact actually justifies.";
  if (cats.has("physical"))
    return "Your body is asking for something the schedule isn't giving it. The tiredness is shaping your mood more than it might seem.";
  return "The same few pressures keep resurfacing in how you describe the day. Naming them, as you just did, is the first step to loosening their hold.";
}

function analyzeLocally(input) {
  const text = input.journal.toLowerCase();
  const triggers = [];
  const strategies = [];
  const seen = new Set();

  TRIGGER_RULES.forEach(rule => {
    if (rule.match.some(k => text.includes(k))) {
      triggers.push({ label: rule.label, category: rule.category });
      rule.strategies.forEach(s => {
        if (!seen.has(s.title)) { seen.add(s.title); strategies.push(s); }
      });
    }
  });

  if (strategies.length === 0) {
    GENERAL_STRATEGIES.forEach(s => strategies.push(s));
  }

  const cats = new Set(triggers.map(t => t.category));
  const mindful = input.mood <= 2 ? MINDFULNESS.low : input.mood === 3 ? MINDFULNESS.mid : MINDFULNESS.good;
  const wellness = assessWellness(input.mood, input.sleepHours, triggers.length);

  return {
    emotion: emotionLabel(input.mood, cats),
    triggers,
    patterns: buildPattern(triggers, input.mood),
    strategies: strategies.slice(0, 4),
    mindfulness: mindful,
    encouragement: pick(ENCOURAGEMENTS[wellness.klass] || ENCOURAGEMENTS.ok),
    wellness,
    safety: detectCrisis(input.journal),
    source: "offline",
  };
}

// --- reflection request (AI first, offline fallback) -----------------------

async function requestReflection(input) {
  try {
    const res = await fetch("/api/reflect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error("ai_unavailable");
    const data = await res.json();
    if (!data || !data.wellness) throw new Error("bad_response");
    return data;
  } catch (err) {
    return analyzeLocally(input);
  }
}

// --- companion chat: offline fallback --------------------------------------

const GREETING =
  "Hi, I'm MannMitra. This is a no-pressure space — tell me whatever's on your mind about your prep, " +
  "your day, or how you're feeling. I'm listening.";

const GENERIC_REPLIES = [
  "Thank you for telling me that. It takes something to put it into words. What part of it feels heaviest right now?",
  "I hear you, and what you're feeling makes complete sense given everything you're carrying. You're not overreacting.",
  "That sounds genuinely hard. You don't have to have it all figured out today. What's one small thing that might make the next hour a little lighter?",
  "I'm really glad you said that out loud. Be as kind to yourself as you'd be to a friend in your seat. What would help most right now — to vent, or to make a tiny plan?",
];

function localReply(text) {
  const safety = detectCrisis(text);
  if (safety.crisis) return { reply: safety.message, safety };

  const low = text.toLowerCase();
  for (const rule of TRIGGER_RULES) {
    if (rule.match.some(k => low.includes(k))) {
      const s = rule.strategies[0];
      return {
        reply: `That's a real weight, and "${rule.label.toLowerCase()}" trips up so many aspirants — you're far from alone in it. One small thing that can help: ${s.detail} Want to talk through it a bit more?`,
        safety,
      };
    }
  }
  return { reply: pick(GENERIC_REPLIES), safety };
}

// --- history formatting helpers --------------------------------------------

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function klassForScore(s) {
  return s >= 55 ? "ok" : s >= 35 ? "warn" : "over";
}
