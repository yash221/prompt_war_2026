/*
 * MindEase - engine + UI. Pure client side where it can be.
 * Two features:
 *   1. Daily check-in -> structured wellness reflection (AI, with a full
 *      deterministic offline fallback so it always works).
 *   2. Companion chat -> conversational support (AI, with offline fallback).
 * Crisis detection runs locally too, so safety holds even with no network.
 */

// --- small helpers ---------------------------------------------------------

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

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

// The most recent check-in input, kept so "Reflect again" can re-run it.
let lastInput = null;

function detectCrisis(text) {
  if (text && CRISIS_RE.test(text)) {
    return { crisis: true, message: CRISIS_MESSAGE, helplines: HELPLINES };
  }
  return { crisis: false };
}

// --- storage (server via Supabase + localStorage mirror) -------------------

const LS_HISTORY = "mindease_history";
const MOOD_EMOJI = { 1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "😄" };

// One stable anonymous id per browser, so history is "yours" without a login.
function getAnonId() {
  let id = localStorage.getItem("mindease_id");
  if (!id) {
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : "u-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("mindease_id", id);
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

function assessWellness(mood, sleep, triggerCount) {
  const baseTable = { 1: 25, 2: 42, 3: 60, 4: 76, 5: 90 };
  let base = baseTable[mood] != null ? baseTable[mood] : 60;

  if (sleep != null) {
    if (sleep < 5) base -= 12;
    else if (sleep < 6) base -= 6;
    else if (sleep >= 7) base += 4;
  }
  base -= Math.min(Math.max(triggerCount - 1, 0) * 4, 16);

  const score = Math.max(5, Math.min(100, base));
  if (score >= 75)
    return { score, state: "Steady", klass: "ok",
      advice: "You're holding up well. Keep protecting the habits that are working for you." };
  if (score >= 55)
    return { score, state: "Managing", klass: "ok",
      advice: "You're coping, with some strain. The strategies below can give you a bit more breathing room." };
  if (score >= 35)
    return { score, state: "Strained", klass: "warn",
      advice: "Stress is running high. Be gentle with yourself today and try one small reset below." };
  return { score, state: "Overwhelmed", klass: "over",
    advice: "You're carrying a lot right now. Please go easy on yourself, and consider talking to someone you trust." };
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

// --- reflection rendering --------------------------------------------------

function crisisBanner(safety) {
  const box = el("div", "crisis-banner");
  const lines = safety.helplines
    .map(h => `<li><b>${esc(h.name)}</b> · <span class="hl-num">${esc(h.contact)}</span> <em>${esc(h.note)}</em></li>`)
    .join("");
  box.innerHTML = `
    <div class="crisis-head">🤍 You deserve support right now</div>
    <p>${esc(safety.message)}</p>
    <ul class="helplines">${lines}</ul>`;
  return box;
}

function renderReflection(result) {
  const out = document.getElementById("result");
  out.innerHTML = "";

  if (result.safety && result.safety.crisis) {
    out.appendChild(crisisBanner(result.safety));
  }

  // Wellness banner
  const w = result.wellness;
  const banner = el("div", `wellness-banner ${w.klass}`);
  const srcLabel = result.source === "ai"
    ? `<span class="src ai">⚡ AI reflection</span>`
    : `<span class="src off">offline mode</span>`;
  banner.innerHTML = `
    <div class="wellness-head">
      <span class="badge">${esc(w.state)}</span>
      <span class="wellness-figure">${num(w.score)}<small>/100 wellness</small></span>
    </div>
    <p class="emotion-line">You sound <b>${esc(result.emotion)}</b> today. ${srcLabel}</p>
    <div class="meter"><div class="fill" style="width:${Math.min(num(w.score), 100)}%"></div></div>
    <p>${esc(w.advice)}</p>`;
  out.appendChild(banner);

  // Insight panel: what MindEase notices
  const insight = el("div", "panel");
  insight.innerHTML = `<h3>🔎 What I'm noticing</h3><p class="pattern">${esc(result.patterns)}</p>`;
  if (result.triggers.length) {
    const chips = el("div", "trigger-chips");
    result.triggers.forEach(t => chips.appendChild(el("span", "trig", esc(t.label))));
    insight.appendChild(el("div", "field-label", "Possible stress triggers"));
    insight.appendChild(chips);
  }
  out.appendChild(insight);

  // Coping strategies
  const strat = el("div", "panel");
  strat.innerHTML = `<h3>🧭 Coping strategies to try</h3>`;
  const sl = el("ul", "strategy-list");
  result.strategies.forEach(s => {
    sl.appendChild(el("li", null,
      `<label><input type="checkbox"><span><b>${esc(s.title)}</b><em>${esc(s.detail)}</em></span></label>`));
  });
  strat.appendChild(sl);
  out.appendChild(strat);

  // Mindfulness exercise (with a gentle breathing orb)
  const m = result.mindfulness;
  const mind = el("div", "panel mindful");
  const steps = m.steps.map(s => `<li>${esc(s)}</li>`).join("");
  mind.innerHTML = `
    <div class="mindful-head">
      <h3>🌬️ ${esc(m.name)}</h3>
      <span class="duration">${esc(m.duration)}</span>
    </div>
    <div class="breath" aria-hidden="true"><div class="orb"></div><span class="breath-label">breathe</span></div>
    <ol class="steps">${steps}</ol>`;
  out.appendChild(mind);

  // Encouragement
  const note = el("div", "encourage");
  note.innerHTML = `<span class="quote-mark">“</span>${esc(result.encouragement)}`;
  out.appendChild(note);

  // Actions
  const actions = el("div", "result-actions");
  const againBtn = el("button", "ghost", "🔁 Reflect again");
  againBtn.onclick = async () => {
    if (!lastInput) return;
    showReflecting();
    renderReflection(await requestReflection(lastInput));
  };
  const copyBtn = el("button", "ghost", "📋 Copy reflection");
  copyBtn.onclick = () => copyReflection(result, copyBtn);
  actions.append(againBtn, copyBtn);
  out.appendChild(actions);

  out.scrollIntoView({ behavior: "smooth", block: "start" });
}

function copyReflection(r, btn) {
  let t = `MindEase reflection — feeling ${r.emotion} (wellness ${r.wellness.score}/100, ${r.wellness.state})\n\n`;
  if (r.triggers.length) t += `TRIGGERS:\n- ${r.triggers.map(x => x.label).join("\n- ")}\n\n`;
  t += `NOTICING: ${r.patterns}\n\n`;
  t += `STRATEGIES:\n` + r.strategies.map(s => `- ${s.title}: ${s.detail}`).join("\n") + "\n\n";
  t += `MINDFULNESS — ${r.mindfulness.name} (${r.mindfulness.duration}):\n- ` + r.mindfulness.steps.join("\n- ") + "\n\n";
  t += `${r.encouragement}\n`;
  navigator.clipboard.writeText(t).then(() => {
    btn.textContent = "✅ Copied!";
    setTimeout(() => (btn.textContent = "📋 Copy reflection"), 1500);
  });
}

function showReflecting() {
  const out = document.getElementById("result");
  out.innerHTML = `
    <div class="empty">
      <div class="empty-icon pulse">🌿</div>
      <p>Reading your words with care…</p>
    </div>`;
}

// --- companion chat --------------------------------------------------------

const GREETING =
  "Hi, I'm MindEase. This is a no-pressure space — tell me whatever's on your mind about your prep, " +
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

const chatHistory = []; // {role, content}

function renderChatMessage(role, content, safety) {
  const log = document.getElementById("chat-log");
  const row = el("div", `msg ${role}`);
  if (role === "assistant") {
    row.innerHTML = `<span class="avatar">🌿</span><div class="bubble">${esc(content)}</div>`;
  } else {
    row.innerHTML = `<div class="bubble">${esc(content)}</div>`;
  }
  log.appendChild(row);

  if (safety && safety.crisis) {
    const help = el("div", "msg assistant");
    const lines = safety.helplines
      .map(h => `<li><b>${esc(h.name)}</b> · <span class="hl-num">${esc(h.contact)}</span></li>`).join("");
    help.innerHTML = `<span class="avatar">🤍</span><div class="bubble crisis-bubble">
      Please reach out to someone who can be with you right now:
      <ul class="helplines">${lines}</ul></div>`;
    log.appendChild(help);
  }
  log.scrollTop = log.scrollHeight;
}

function showTyping() {
  const log = document.getElementById("chat-log");
  const row = el("div", "msg assistant typing-row");
  row.id = "typing";
  row.innerHTML = `<span class="avatar">🌿</span><div class="bubble typing"><span></span><span></span><span></span></div>`;
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function removeTyping() {
  const t = document.getElementById("typing");
  if (t) t.remove();
}

async function sendChat(text) {
  chatHistory.push({ role: "user", content: text });
  renderChatMessage("user", text);
  showTyping();

  let result;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: chatHistory }),
    });
    if (!res.ok) throw new Error("ai_unavailable");
    const data = await res.json();
    if (!data || !data.reply) throw new Error("bad_response");
    result = { reply: data.reply, safety: data.safety };
  } catch (err) {
    result = localReply(text);
  }

  removeTyping();
  chatHistory.push({ role: "assistant", content: result.reply });
  renderChatMessage("assistant", result.reply, result.safety);
}

// --- history view ----------------------------------------------------------

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function klassForScore(s) {
  return s >= 55 ? "ok" : s >= 35 ? "warn" : "over";
}

function renderHistory(items) {
  const list = document.getElementById("history-list");
  const trend = document.getElementById("trend");
  const sub = document.getElementById("history-sub");
  list.innerHTML = "";

  if (!items.length) {
    trend.classList.add("hidden");
    list.innerHTML = `<div class="empty"><div class="empty-icon">🗂️</div>
      <p>No check-ins yet. Do a daily check-in and it'll appear here.</p></div>`;
    return;
  }

  // Trend: oldest -> newest, last 12 scores.
  const chrono = items.slice().reverse().slice(-12);
  const bars = document.getElementById("trend-bars");
  bars.innerHTML = "";
  chrono.forEach(it => {
    const s = num(it.wellness_score);
    const bar = el("div", `tbar ${klassForScore(s)}`);
    bar.style.height = Math.max(6, s) + "%";
    bar.title = `${s}/100`;
    bars.appendChild(bar);
  });
  trend.classList.remove("hidden");
  sub.textContent = `${items.length} check-in${items.length > 1 ? "s" : ""} saved on this device.`;

  // List: newest first.
  items.forEach(it => {
    const s = num(it.wellness_score);
    const row = el("div", "hist-item");
    const chips = (it.triggers || []).slice(0, 3)
      .map(t => `<span class="trig sm">${esc(t.label)}</span>`).join("");
    row.innerHTML = `
      <span class="hist-mood">${MOOD_EMOJI[it.mood] || "😐"}</span>
      <div class="hist-body">
        <div class="hist-top">
          <span class="hist-score ${klassForScore(s)}">${s}</span>
          <b>${esc(it.wellness_state || "")}</b>
          <span class="muted">· feeling ${esc(it.emotion || "")}</span>
        </div>
        <div class="hist-date">${esc(fmtDate(it.created_at))}${it.crisis ? ' · <span class="hist-flag">support shown</span>' : ""}</div>
        ${chips ? `<div class="hist-trigs">${chips}</div>` : ""}
      </div>`;
    list.appendChild(row);
  });
}

async function loadHistory() {
  let items = [];
  try {
    const res = await fetch("/api/checkins?anon_id=" + encodeURIComponent(getAnonId()));
    const data = await res.json();
    if (data && Array.isArray(data.items) && data.items.length) items = data.items;
  } catch (e) { /* fall back to local */ }
  if (!items.length) items = localHistory();
  renderHistory(items);
}

// --- wiring ----------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  // Tabs
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => {
        const on = t === tab;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      const which = tab.dataset.tab;
      document.getElementById("view-checkin").classList.toggle("hidden", which !== "checkin");
      document.getElementById("view-companion").classList.toggle("hidden", which !== "companion");
      document.getElementById("view-history").classList.toggle("hidden", which !== "history");
      if (which === "history") loadHistory();
    });
  });

  // Mood picker
  const moodInput = document.querySelector('input[name="mood"]');
  const moods = document.querySelectorAll(".mood");
  moods.forEach(btn => {
    btn.addEventListener("click", () => {
      moods.forEach(b => {
        const on = b === btn;
        b.classList.toggle("selected", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
      moodInput.value = btn.dataset.mood;
    });
  });

  // Sleep slider: keep the readout in sync (was an inline handler in HTML).
  const sleepRange = document.getElementById("sleepRange");
  const sleepVal = document.getElementById("sleepVal");
  sleepRange.addEventListener("input", () => { sleepVal.textContent = sleepRange.value; });

  // Check-in form
  const form = document.getElementById("checkin-form");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const journal = (fd.get("journal") || "").toString().trim();
    if (journal.length < 3) {
      alert("Write a few words about your day first — even one honest line helps.");
      return;
    }
    const days = parseInt(fd.get("daysToExam"), 10);
    const input = {
      mood: parseInt(fd.get("mood"), 10) || 3,
      journal,
      exam: fd.get("exam") || "other",
      daysToExam: Number.isFinite(days) ? days : null,
      sleepHours: parseInt(fd.get("sleepHours"), 10),
    };
    lastInput = input;
    showReflecting();
    const result = await requestReflection(input);
    renderReflection(result);
    saveCheckin(input, result);
  });

  // Companion chat
  renderChatMessage("assistant", GREETING);
  chatHistory.push({ role: "assistant", content: GREETING });
  const chatForm = document.getElementById("chat-form");
  const chatText = document.getElementById("chat-text");
  chatForm.addEventListener("submit", e => {
    e.preventDefault();
    const text = chatText.value.trim();
    if (!text) return;
    chatText.value = "";
    sendChat(text);
  });
});
